/**
 * Restore drill on the local stack (M7.3-11, SPEC 8 "tested once before go-live"):
 * backup → `supabase db reset --no-seed` (a fresh project from the migrations) → restore →
 * every dumped table has the same row count and content hash, every Storage object downloads
 * with the same SHA-256. It replaces the local database with its own restored copy.
 *
 * Usage: node scripts/backup/restore-drill.mts --reset-local-database
 */
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { createBackupArchive, type Log } from "./backup.mts";
import { BackupError, describeUnexpected } from "./backup-error.mts";
import { quoteTable } from "./manifest.mts";
import { pgEnvFromUrl, restoreArchive } from "./restore.mts";
import { countUnmatchedObjects, type StorageTarget } from "./storage.mts";
import { readLocalStack, resetLocalDatabase, type LocalStack } from "./supabase-source.mts";

const execFileAsync = promisify(execFile);

/** Count and an order-independent content hash per table, read in one psql call. */
export async function tableFingerprints(
  dbUrl: string,
  tables: string[],
): Promise<Record<string, string>> {
  if (tables.length === 0) {
    return {};
  }
  const sql = tables
    .map(
      (table) =>
        `select '${table}' || '|' || count(*) || '|' || ` +
        `md5(coalesce(string_agg(t::text, E'\\n' order by t::text), '')) from ${quoteTable(table)} as t`,
    )
    .join("\nunion all\n");
  const { stdout } = await execFileAsync(
    "psql",
    ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      env: { ...process.env, ...pgEnvFromUrl(dbUrl) },
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const result: Record<string, string> = {};
  for (const line of stdout.trim().split("\n")) {
    const [table, ...rest] = line.split("|");
    result[table] = rest.join("|");
  }
  return result;
}

/** Drill markers: one object per bucket and one client row, so nothing is restored from nothing. */
async function addMarkers(stack: LocalStack, storage: StorageTarget): Promise<void> {
  const marker = `Restore drill ${randomUUID()}`;
  const headers = { apikey: stack.serviceKey, Authorization: `Bearer ${stack.serviceKey}` };
  const client = await fetch(`${stack.apiUrl}/rest/v1/clients`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ name: marker }),
  });
  if (!client.ok) {
    throw new BackupError(`Drill marker row failed: HTTP ${client.status}`);
  }
  const files = [
    { bucket: "receipts", type: "application/pdf", ext: "pdf" },
    { bucket: "expense-files", type: "image/png", ext: "png" },
  ];
  for (const file of files) {
    const body = Buffer.concat([Buffer.from(`%drill ${marker}\n`), randomBytes(2048)]);
    const response = await fetch(
      `${storage.apiUrl}/storage/v1/object/${file.bucket}/restore-drill/${randomUUID()}.${file.ext}`,
      { method: "POST", headers: { ...headers, "Content-Type": file.type }, body },
    );
    if (!response.ok) {
      throw new BackupError(`Drill marker object failed: HTTP ${response.status}`);
    }
  }
}

export async function runRestoreDrill(log: Log = console.log): Promise<void> {
  const stack = await readLocalStack();
  const storage: StorageTarget = { apiUrl: stack.apiUrl, serviceKey: stack.serviceKey };
  const workDir = mkdtempSync(join(tmpdir(), "hkmanager-drill-"));
  try {
    await addMarkers(stack, storage);
    const archive = await createBackupArchive({
      source: { kind: "local" },
      storage,
      environment: "local",
      workDir,
      log,
    });
    const { manifest } = archive;
    const tables = Object.keys(manifest.database.rowCounts).sort();
    const before = await tableFingerprints(stack.dbUrl, tables);
    if (manifest.storage.objects.length < 2) {
      throw new BackupError("Drill: the backup holds fewer objects than the markers");
    }

    log("Resetting the local database (supabase db reset --no-seed)…");
    await resetLocalDatabase();
    const gone = await countUnmatchedObjects(
      storage,
      manifest.storage.objects,
      join(workDir, "after-reset"),
    );
    log(`After reset: ${gone} of ${manifest.storage.objects.length} objects unavailable`);
    if (gone !== manifest.storage.objects.length) {
      throw new BackupError(
        "Drill: Storage objects survived the reset, the check would prove nothing",
      );
    }

    await restoreArchive({
      archivePath: archive.path,
      dbUrl: stack.dbUrl,
      storage,
      replace: false,
      log,
    });

    const compare = async (stage: string) => {
      const after = await tableFingerprints(stack.dbUrl, tables);
      const differing = tables.filter((table) => before[table] !== after[table]);
      if (differing.length > 0) {
        throw new BackupError(`Drill: tables differ ${stage}: ${differing.join(", ")}`);
      }
    };
    await compare("after restore");

    // A second restore into a project that now holds data is refused, then --replace works.
    const refused = await restoreArchive({
      archivePath: archive.path,
      dbUrl: stack.dbUrl,
      storage,
      replace: false,
    }).then(
      () => false,
      (error: unknown) =>
        error instanceof BackupError && error.message.includes("already holds data"),
    );
    if (!refused) {
      throw new BackupError("Drill: a restore over existing data was not refused");
    }
    log("Restore over existing data without --replace: refused, nothing changed");
    await restoreArchive({
      archivePath: archive.path,
      dbUrl: stack.dbUrl,
      storage,
      replace: true,
      log,
    });
    await compare("after --replace restore");
    const mismatched = await countUnmatchedObjects(
      storage,
      manifest.storage.objects,
      join(workDir, "after-restore"),
    );
    if (mismatched > 0) {
      throw new BackupError(
        `Drill: ${mismatched} Storage objects missing or different after restore`,
      );
    }
    const rows = Object.values(manifest.database.rowCounts).reduce((sum, n) => sum + n, 0);
    log(
      `Restore drill: PASS (${tables.length} tables / ${rows} rows identical by count and content hash; ` +
        `${manifest.storage.objects.length} objects identical by SHA-256)`,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv.includes("--reset-local-database")) {
    console.error(
      "This drill replaces the local database with a restored copy. " +
        "Run: node scripts/backup/restore-drill.mts --reset-local-database",
    );
    process.exitCode = 2;
  } else {
    runRestoreDrill().catch((error: unknown) => {
      console.error(`Restore drill failed: ${describeUnexpected(error)}`);
      process.exitCode = 1;
    });
  }
}
