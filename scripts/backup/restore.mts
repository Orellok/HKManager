/**
 * Restores a backup archive (M7.3-10, docs/setup/restore.md) into a project whose schema came
 * from the repository migrations at the manifest's commit: checksums → database data in one
 * transaction (row counts checked before commit) → every Storage object.
 *
 * Usage: RESTORE_DB_URL=… RESTORE_API_URL=… RESTORE_SERVICE_KEY=… \
 *   node scripts/backup/restore.mts <backup.tar.gz> --yes [--replace]
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { BackupError, describeUnexpected } from "./backup-error.mts";
import {
  DATA_FILE,
  hashFile,
  MANIFEST_FILE,
  parseManifest,
  quoteTable,
  type Manifest,
} from "./manifest.mts";
import { objectFilePath, uploadObject, type StorageTarget } from "./storage.mts";

const execFileAsync = promisify(execFile);
const PSQL_TIMEOUT_MS = 60 * 60_000;
const PSQL_MAX_BUFFER = 16 * 1024 * 1024;

/** Rows the migrations themselves insert; a fresh project already has them. */
export const SEEDED_BY_MIGRATIONS = new Set([
  "public.app_settings",
  "public.expense_categories",
  "public.tax_year_settings",
]);

export type Log = (line: string) => void;

export async function extractArchive(archivePath: string, dir: string): Promise<Manifest> {
  try {
    await execFileAsync("tar", [
      "-xzf",
      archivePath,
      "-C",
      dir,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
  } catch {
    throw new BackupError("The archive could not be unpacked");
  }
  return parseManifest(readFileSync(join(dir, MANIFEST_FILE), "utf8"));
}

/** Every database file and Storage object must match the manifest's SHA-256 and size. */
export async function verifyChecksums(dir: string, manifest: Manifest): Promise<void> {
  for (const file of manifest.database.files) {
    const { digest, bytes } = await hashFile(join(dir, file.path), "sha256");
    if (digest !== file.sha256 || bytes !== file.bytes) {
      throw new BackupError(`Checksum mismatch: ${file.path}`);
    }
  }
  for (const [index, object] of manifest.storage.objects.entries()) {
    const file = objectFilePath(join(dir, "storage"), object.bucket, object.path);
    const { digest, bytes } = await hashFile(file, "sha256");
    if (digest !== object.sha256 || bytes !== object.bytes) {
      throw new BackupError(`Checksum mismatch: Storage object #${index + 1} in ${object.bucket}`);
    }
  }
}

/**
 * Runs before data.sql in the same transaction: refuses a target that already holds data
 * (unless replacing), then empties the dumped tables. Triggers are off (replica role) as in
 * data.sql, so audit and timestamp triggers do not rewrite restored rows.
 */
export function buildPrelude(rowCounts: Record<string, number>, replace: boolean): string {
  const tables = Object.keys(rowCounts).sort();
  const lines = ["set session_replication_role = replica;"];
  const guarded = tables.filter((table) => !SEEDED_BY_MIGRATIONS.has(table));
  if (!replace && guarded.length > 0) {
    lines.push(
      "do $$",
      "begin",
      `  if ${guarded.map((table) => `exists (select 1 from ${quoteTable(table)})`).join("\n    or ")} then`,
      "    raise exception using errcode = 'HKR01',",
      "      message = 'The target already holds data. Restore into a fresh project, or pass --replace.';",
      "  end if;",
      "end $$;",
    );
  }
  if (tables.length > 0) {
    lines.push(`truncate table ${tables.map(quoteTable).join(", ")};`);
  }
  return `${lines.join("\n")}\n`;
}

/** Runs after data.sql, still inside the transaction: any count mismatch rolls it all back. */
export function buildRowCountCheck(rowCounts: Record<string, number>): string {
  const checks = Object.entries(rowCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([table, count]) => {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new BackupError("Unexpected row count in the manifest");
      }
      return [
        `  select count(*) into n from ${quoteTable(table)};`,
        `  if n <> ${count} then`,
        `    raise exception using errcode = 'HKR02', message = format('Row count mismatch in %s: %s, expected ${count}', '${table}', n);`,
        "  end if;",
      ].join("\n");
    });
  return ["do $$", "declare n bigint;", "begin", ...checks, "end $$;", ""].join("\n");
}

/** libpq environment from a postgres:// URL, so the password is not a process argument. */
export function pgEnvFromUrl(url: string): Record<string, string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BackupError("RESTORE_DB_URL is not a valid postgres:// URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new BackupError("RESTORE_DB_URL is not a valid postgres:// URL");
  }
  const env: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres",
  };
  const sslmode = parsed.searchParams.get("sslmode");
  if (sslmode) {
    env.PGSSLMODE = sslmode;
  }
  return env;
}

export async function restoreDatabase(
  dir: string,
  manifest: Manifest,
  dbUrl: string,
  replace: boolean,
): Promise<void> {
  const prelude = join(dir, "restore-prelude.sql");
  const check = join(dir, "restore-check.sql");
  writeFileSync(prelude, buildPrelude(manifest.database.rowCounts, replace), { mode: 0o600 });
  writeFileSync(check, buildRowCountCheck(manifest.database.rowCounts), { mode: 0o600 });
  try {
    await execFileAsync(
      "psql",
      [
        "-X",
        "-q",
        "--single-transaction",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        prelude,
        "-f",
        join(dir, DATA_FILE),
        "-f",
        check,
      ],
      {
        env: { ...process.env, ...pgEnvFromUrl(dbUrl) },
        timeout: PSQL_TIMEOUT_MS,
        maxBuffer: PSQL_MAX_BUFFER,
      },
    );
  } catch (error) {
    // Local terminal only (never a public log): psql's own error says what to fix.
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const reason = stderr.split("\n").find((line) => line.includes("ERROR:")) ?? "psql failed";
    throw new BackupError(`Database restore failed, nothing was changed: ${reason.trim()}`);
  }
}

export async function restoreStorage(
  dir: string,
  manifest: Manifest,
  target: StorageTarget,
): Promise<void> {
  for (const object of manifest.storage.objects) {
    await uploadObject(target, object, join(dir, "storage"));
  }
}

export async function restoreArchive(options: {
  archivePath: string;
  dbUrl: string;
  storage: StorageTarget;
  replace: boolean;
  log?: Log;
}): Promise<Manifest> {
  const log = options.log ?? (() => undefined);
  const dir = mkdtempSync(join(tmpdir(), "hkmanager-restore-"));
  try {
    const manifest = await extractArchive(options.archivePath, dir);
    await verifyChecksums(dir, manifest);
    log(
      `Backup of ${manifest.environment} from ${manifest.createdAt} (commit ${manifest.commit}, ` +
        `latest migration ${manifest.latestMigration}): checksums OK`,
    );
    await restoreDatabase(dir, manifest, options.dbUrl, options.replace);
    const rows = Object.values(manifest.database.rowCounts).reduce((sum, n) => sum + n, 0);
    log(
      `Database: restored ${rows} rows in ${Object.keys(manifest.database.rowCounts).length} tables (counts verified)`,
    );
    await restoreStorage(dir, manifest, options.storage);
    log(`Storage: uploaded ${manifest.storage.objects.length} objects`);
    return manifest;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new BackupError(`${name} is not set (docs/setup/restore.md)`);
  }
  return value;
}

async function main(args: string[]): Promise<number> {
  const archivePath = args.find((arg) => !arg.startsWith("--"));
  if (!archivePath || !args.includes("--yes")) {
    console.error(
      "Usage: RESTORE_DB_URL=… RESTORE_API_URL=… RESTORE_SERVICE_KEY=… " +
        "node scripts/backup/restore.mts <backup.tar.gz> --yes [--replace]",
    );
    return 2;
  }
  const dbUrl = requiredEnv("RESTORE_DB_URL");
  const apiUrl = requiredEnv("RESTORE_API_URL").replace(/\/+$/, "");
  const serviceKey = requiredEnv("RESTORE_SERVICE_KEY");
  console.log(`Restoring into ${new URL(apiUrl).host} (database ${pgEnvFromUrl(dbUrl).PGHOST})`);
  await restoreArchive({
    archivePath,
    dbUrl,
    storage: { apiUrl, serviceKey },
    replace: args.includes("--replace"),
    log: console.log,
  });
  console.log("Restore: done. Continue with the steps after a restore (docs/setup/restore.md).");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`Restore failed: ${describeUnexpected(error)}`);
      process.exitCode = 1;
    },
  );
}
