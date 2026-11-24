/**
 * The weekly backup (M7.3, SPEC 8): database dump + every Storage object → one archive →
 * the app's folder in the owner's Google Drive → verified → retention (12 per environment).
 * Run by .github/workflows/backup.yml. The repository is public, so only outcomes, counts and
 * sizes are printed (M7.3-6).
 *
 * Usage: node scripts/backup/backup.mts   (configuration from environment variables only)
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { BackupError, describeUnexpected } from "./backup-error.mts";
import {
  BACKUP_APP_PROPERTY,
  createDriveClient,
  getAccessToken,
  type DriveClient,
  type DriveCredentials,
} from "./google-drive.mts";
import {
  countCopyRowsInFile,
  DATA_FILE,
  hashFile,
  MANIFEST_FILE,
  MANIFEST_FORMAT,
  SCHEMA_FILE,
  type FileEntry,
  type Manifest,
} from "./manifest.mts";
import {
  backupFileName,
  isBackupEnvironment,
  selectBackupsToDelete,
  type BackupEnvironment,
} from "./retention.mts";
import { exportStorage, type StorageTarget } from "./storage.mts";
import {
  dumpDatabase,
  fetchServiceKey,
  remoteSource,
  type BackupSource,
} from "./supabase-source.mts";

const execFileAsync = promisify(execFile);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const MEGABYTE = 1024 * 1024;

export type Log = (line: string) => void;

export function formatSize(bytes: number): string {
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

export function latestMigration(dir: string = MIGRATIONS_DIR): string {
  const versions = readdirSync(dir)
    .map((name) => /^(\d{14})_.*\.sql$/.exec(name)?.[1])
    .filter((version): version is string => version !== undefined)
    .sort();
  return versions.at(-1) ?? "none";
}

function currentCommit(): string {
  const fromActions = process.env.GITHUB_SHA;
  if (fromActions && /^[0-9a-f]{40}$/.test(fromActions)) {
    return fromActions;
  }
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : "unknown";
  } catch {
    return "unknown";
  }
}

/** Work files must stay out of the repository checkout (M7.3-6). */
export function assertOutsideRepository(dir: string): void {
  const fromRepo = relative(REPO_ROOT, resolve(dir));
  if (
    !isAbsolute(dir) ||
    fromRepo === "" ||
    (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))
  ) {
    throw new BackupError("BACKUP_WORK_DIR must be an absolute path outside the repository");
  }
}

/** Masks a secret in the GitHub Actions log (no-op elsewhere). */
function maskInActions(secret: string): void {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::add-mask::${secret}`);
  }
}

export type CreatedArchive = { path: string; name: string; bytes: number; manifest: Manifest };

/**
 * Dumps the database, exports Storage, writes the manifest and packs everything into
 * `<workDir>/<name>.tar.gz`. The unpacked files are removed before returning.
 */
export async function createBackupArchive(options: {
  source: BackupSource;
  storage: StorageTarget;
  environment: BackupEnvironment;
  workDir: string;
  now?: Date;
  log?: Log;
}): Promise<CreatedArchive> {
  const { source, storage, environment, workDir } = options;
  const log = options.log ?? (() => undefined);
  const now = options.now ?? new Date();
  const contentDir = join(workDir, "content");
  mkdirSync(join(contentDir, "db"), { recursive: true, mode: 0o700 });
  mkdirSync(join(contentDir, "storage"), { recursive: true, mode: 0o700 });
  try {
    await dumpDatabase(source, contentDir);
    const rowCounts = await countCopyRowsInFile(join(contentDir, DATA_FILE));
    const files: FileEntry[] = [];
    for (const path of [DATA_FILE, SCHEMA_FILE] as const) {
      const { digest, bytes } = await hashFile(join(contentDir, path), "sha256");
      files.push({ path, bytes, sha256: digest });
    }
    const tables = Object.keys(rowCounts).length;
    const rows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
    log(`Database dump: OK (${tables} tables, ${rows} rows, ${formatSize(files[0].bytes)})`);

    const objects = await exportStorage(storage, join(contentDir, "storage"));
    const buckets = new Set(objects.map((object) => object.bucket)).size;
    const storageBytes = objects.reduce((sum, object) => sum + object.bytes, 0);
    log(
      `Storage export: OK (${objects.length} objects in ${buckets} buckets, ${formatSize(storageBytes)})`,
    );

    const manifest: Manifest = {
      format: MANIFEST_FORMAT,
      environment,
      createdAt: now.toISOString(),
      commit: currentCommit(),
      latestMigration: latestMigration(),
      database: { files, rowCounts },
      storage: { objects },
    };
    writeFileSync(join(contentDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
    });

    const name = backupFileName(environment, now);
    const path = join(workDir, name);
    try {
      await execFileAsync("tar", ["-czf", path, "-C", contentDir, MANIFEST_FILE, "db", "storage"]);
    } catch {
      throw new BackupError("Packing the archive failed");
    }
    const { bytes } = await hashFile(path, "sha256");
    log(`Archive: ${name} (${formatSize(bytes)})`);
    return { path, name, bytes, manifest };
  } finally {
    rmSync(contentDir, { recursive: true, force: true });
  }
}

/** Uploads, verifies size and MD5 against Drive, then applies retention (M7.3-3, 4). */
export async function uploadBackup(options: {
  drive: DriveClient;
  folderId: string;
  archive: Pick<CreatedArchive, "path" | "name" | "bytes">;
  environment: BackupEnvironment;
  log?: Log;
}): Promise<{ uploadedId: string; deleted: number }> {
  const { drive, folderId, archive, environment } = options;
  const log = options.log ?? (() => undefined);
  const { digest: md5 } = await hashFile(archive.path, "md5");
  const uploadedId = await drive.uploadFile(folderId, archive.name, archive.path, archive.bytes, {
    [BACKUP_APP_PROPERTY]: "1",
    environment,
  });
  const stored = await drive.getFile(uploadedId);
  if (stored.trashed || stored.size !== archive.bytes || stored.md5Checksum !== md5) {
    throw new BackupError("Upload verification failed: Drive's copy differs; nothing deleted");
  }
  log("Upload: verified (size and MD5 match)");

  const toDelete = selectBackupsToDelete(
    await drive.listBackups(folderId),
    environment,
    uploadedId,
  );
  for (const file of toDelete) {
    await drive.deleteFile(file.id);
  }
  log(`Retention: ${toDelete.length} older backup(s) deleted, newest 12 kept`);
  return { uploadedId, deleted: toDelete.length };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BackupError(`${name} is not set (docs/setup/backups.md)`);
  }
  return value;
}

export async function runBackup(log: Log = console.log): Promise<void> {
  const environment = requiredEnv("BACKUP_ENVIRONMENT");
  if (!isBackupEnvironment(environment) || environment === "local") {
    throw new BackupError("BACKUP_ENVIRONMENT must be production or staging");
  }
  const workRoot = requiredEnv("BACKUP_WORK_DIR");
  assertOutsideRepository(workRoot);
  const credentials: DriveCredentials = {
    clientId: requiredEnv("GOOGLE_DRIVE_BACKUP_CLIENT_ID"),
    clientSecret: requiredEnv("GOOGLE_DRIVE_BACKUP_CLIENT_SECRET"),
    refreshToken: requiredEnv("GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN"),
  };
  const accessToken = requiredEnv("SUPABASE_ACCESS_TOKEN");
  requiredEnv("SUPABASE_DB_PASSWORD");
  const source = remoteSource(process.env.SUPABASE_PROJECT_REF);

  // Google first: a revoked token fails the run before any data is read.
  const driveToken = await getAccessToken(credentials);
  maskInActions(driveToken);
  const drive = createDriveClient(driveToken);
  const folderId = await drive.findOrCreateFolder();
  log("Google Drive: OK");

  const serviceKey = await fetchServiceKey(source.projectRef, accessToken);
  maskInActions(serviceKey);

  mkdirSync(workRoot, { recursive: true, mode: 0o700 });
  const workDir = mkdtempSync(join(workRoot, "run-"));
  try {
    const archive = await createBackupArchive({
      source,
      storage: { apiUrl: `https://${source.projectRef}.supabase.co`, serviceKey },
      environment,
      workDir,
      log,
    });
    await uploadBackup({ drive, folderId, archive, environment, log });
    log(`Backup of ${environment}: done`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runBackup().catch((error: unknown) => {
    console.error(`::error::Backup failed: ${describeUnexpected(error)}`);
    process.exitCode = 1;
  });
}
