import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBackupArchive } from "../../scripts/backup/backup.mts";
import { extractArchive, verifyChecksums } from "../../scripts/backup/restore.mts";
import { createServiceRoleClient, getLocalSupabaseEnv } from "./support/local-supabase";

/**
 * M7.3-2: the backup archive built from the local stack (the same code the workflow runs
 * against a hosted project): database dump with row counts and every Storage object.
 */
let service: SupabaseClient;
let workDir: string;
const objectPath = `it-backup/${randomUUID()}.pdf`;
const objectBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(1024)]);
const marker = `it-backup-${randomUUID()}`;
let clientId = "";

beforeAll(async () => {
  service = await createServiceRoleClient();
  workDir = mkdtempSync(join(tmpdir(), "it-backup-"));
  const upload = await service.storage
    .from("receipts")
    .upload(objectPath, objectBytes, { contentType: "application/pdf" });
  expect(upload.error).toBeNull();
  const inserted = await service.from("clients").insert({ name: marker }).select("id").single();
  expect(inserted.error).toBeNull();
  clientId = inserted.data?.id as string;
});

afterAll(async () => {
  await service.storage.from("receipts").remove([objectPath]);
  if (clientId) {
    await service.from("clients").delete().eq("id", clientId);
  }
  rmSync(workDir, { recursive: true, force: true });
});

describe("M7.3-2: backup archive from the local stack", () => {
  it("M7.3-2: holds the data dump, every Storage object and a manifest that verifies", async () => {
    const { url, serviceRoleKey } = await getLocalSupabaseEnv();
    const lines: string[] = [];
    const archive = await createBackupArchive({
      source: { kind: "local" },
      storage: { apiUrl: url, serviceKey: serviceRoleKey },
      environment: "local",
      workDir,
      now: new Date("2026-11-28T02:41:07Z"),
      log: (line) => lines.push(line),
    });
    expect(archive.name).toBe("hkmanager-local-2026-11-28T024107Z.tar.gz");
    // The unpacked files are gone; only the archive is left in the work directory.
    expect(existsSync(join(workDir, "content"))).toBe(false);

    const extracted = mkdtempSync(join(workDir, "x-"));
    const manifest = await extractArchive(archive.path, extracted);
    await verifyChecksums(extracted, manifest);
    expect(manifest.environment).toBe("local");
    expect(manifest.latestMigration).toMatch(/^\d{14}$/);
    expect(manifest.database.rowCounts["public.clients"]).toBeGreaterThanOrEqual(1);
    expect(manifest.database.rowCounts).toHaveProperty(["auth.users"]);
    // Only public and auth data: Storage metadata, Vault and cron come from the migrations.
    expect(Object.keys(manifest.database.rowCounts).every((t) => /^(public|auth)\./.test(t))).toBe(
      true,
    );
    expect(readFileSync(join(extracted, "db", "data.sql"), "utf8")).toContain(marker);

    const object = manifest.storage.objects.find(
      (o) => o.bucket === "receipts" && o.path === objectPath,
    );
    expect(object).toMatchObject({ bytes: objectBytes.length, contentType: "application/pdf" });
    expect(readFileSync(join(extracted, "storage", "receipts", ...objectPath.split("/")))).toEqual(
      objectBytes,
    );

    // M7.3-6: the log has outcomes, counts and sizes only.
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toContain(marker);
      expect(line).not.toContain(objectPath);
      expect(line).not.toContain(serviceRoleKey);
    }
  });
});
