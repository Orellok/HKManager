import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeDrive } from "../../tests/support/fake-google-drive";

import { assertOutsideRepository, latestMigration, uploadBackup } from "./backup.mts";
import { createDriveClient } from "./google-drive.mts";
import { backupFileName } from "./retention.mts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function archiveFile(name: string) {
  const dir = mkdtempSync(join(tmpdir(), "upload-test-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, "backup-content");
  return { path, name, bytes: 14 };
}

async function setup(existing: number) {
  const drive = createFakeDrive();
  const client = createDriveClient("token", drive.fetch, async () => undefined);
  const folderId = await client.findOrCreateFolder();
  for (let n = 0; n < existing; n += 1) {
    drive.addFile({
      name: backupFileName("production", new Date(Date.UTC(2026, 0, 3 + 7 * n))),
      mimeType: "application/gzip",
      parents: [folderId],
      appProperties: { hkmanagerBackup: "1" },
    });
  }
  return { drive, client, folderId };
}

const NEW_NAME = backupFileName("production", new Date(Date.UTC(2026, 10, 28, 2, 41)));

describe("M7.3-3/4: upload, verification and retention", () => {
  it("M7.3-4: after a verified upload, 13 old + 1 new → the 2 oldest are deleted", async () => {
    const { drive, client, folderId } = await setup(13);
    const lines: string[] = [];
    const result = await uploadBackup({
      drive: client,
      folderId,
      archive: archiveFile(NEW_NAME),
      environment: "production",
      log: (line) => lines.push(line),
    });
    expect(result.deleted).toBe(2);
    const names = [...drive.files.values()]
      .filter((f) => f.parents.includes(folderId))
      .map((f) => f.name)
      .sort();
    expect(names).toHaveLength(12);
    expect(names).toContain(NEW_NAME);
    expect(names).not.toContain(backupFileName("production", new Date(Date.UTC(2026, 0, 3))));
    expect(lines).toEqual([
      "Upload: verified (size and MD5 match)",
      "Retention: 2 older backup(s) deleted, newest 12 kept",
    ]);
  });

  it("M7.3-4: an MD5 mismatch fails the run and deletes nothing", async () => {
    const { drive, client, folderId } = await setup(13);
    drive.corruptMd5 = true;
    await expect(
      uploadBackup({
        drive: client,
        folderId,
        archive: archiveFile(NEW_NAME),
        environment: "production",
      }),
    ).rejects.toThrow(/verification failed.*nothing deleted/);
    expect(drive.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("M7.3-5: a failing delete fails the run (GitHub then emails the admin)", async () => {
    const { drive, client, folderId } = await setup(12);
    drive.failNext("delete", { status: 500, body: {} });
    await expect(
      uploadBackup({
        drive: client,
        folderId,
        archive: archiveFile(NEW_NAME),
        environment: "production",
      }),
    ).rejects.toThrow("Drive delete failed: HTTP 500");
  });

  it("M7.3-6: the work directory must be outside the repository", () => {
    expect(() => assertOutsideRepository(join(tmpdir(), "backup"))).not.toThrow();
    expect(() => assertOutsideRepository(process.cwd())).toThrow(/outside the repository/);
    expect(() => assertOutsideRepository(join(process.cwd(), "tmp"))).toThrow(/outside/);
    expect(() => assertOutsideRepository("relative/dir")).toThrow(/absolute/);
  });

  it("M7.3-2: the manifest records the newest migration version", () => {
    expect(latestMigration()).toMatch(/^\d{14}$/);
  });
});
