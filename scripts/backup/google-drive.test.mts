import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeDrive } from "../../tests/support/fake-google-drive";

import { BackupError } from "./backup-error.mts";
import {
  BACKUP_FOLDER_NAME,
  createDriveClient,
  getAccessToken,
  REVOKED_TOKEN_MESSAGE,
} from "./google-drive.mts";

const CREDENTIALS = { clientId: "id", clientSecret: "secret", refreshToken: "1//refresh" };
const noSleep = async () => undefined;
const dirs: string[] = [];

function archive(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "drive-test-"));
  dirs.push(dir);
  const file = join(dir, "a.tar.gz");
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("M7.3-3/5: Google token and Drive client", () => {
  it("M7.3-3: exchanges the refresh token for an access token", async () => {
    const drive = createFakeDrive();
    expect(await getAccessToken(CREDENTIALS, drive.fetch)).toBe("ya29.fake-access");
    const form = new URLSearchParams(drive.requests[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
  });

  it("M7.3-5: invalid_grant says to re-run the token script, without the token", async () => {
    const drive = createFakeDrive();
    drive.failNext("token", {
      status: 400,
      body: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    });
    const error = await getAccessToken(CREDENTIALS, drive.fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect((error as Error).message).toBe(REVOKED_TOKEN_MESSAGE);
    expect((error as Error).message).not.toContain("1//refresh");
  });

  it("M7.3-6: other Google errors show status and code only, never the body text", async () => {
    const drive = createFakeDrive();
    drive.failNext("list", {
      status: 403,
      body: {
        error: {
          status: "PERMISSION_DENIED",
          message: "File secret-client-name.pdf",
          errors: [{ reason: "insufficientPermissions" }],
        },
      },
    });
    const client = createDriveClient("token", drive.fetch, noSleep);
    const error = (await client.findOrCreateFolder().catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("Drive folder lookup failed: HTTP 403 (insufficientPermissions)");
  });

  it("M7.3-3: creates the app's folder once and finds it again", async () => {
    const drive = createFakeDrive();
    const client = createDriveClient("token", drive.fetch, noSleep);
    const first = await client.findOrCreateFolder();
    const second = await client.findOrCreateFolder();
    expect(second).toBe(first);
    const folders = [...drive.files.values()].filter((f) => f.name === BACKUP_FOLDER_NAME);
    expect(folders).toHaveLength(1);
  });

  it("M7.3-3: uploads through a resumable session with the backup marker and reads it back", async () => {
    const drive = createFakeDrive();
    const client = createDriveClient("token", drive.fetch, noSleep);
    const folder = await client.findOrCreateFolder();
    const file = archive("archive-bytes");
    const id = await client.uploadFile(
      folder,
      "hkmanager-staging-2026-01-01T000000Z.tar.gz",
      file,
      13,
      {
        hkmanagerBackup: "1",
      },
    );
    const stored = drive.files.get(id);
    expect(stored?.parents).toEqual([folder]);
    expect(new TextDecoder().decode(stored?.bytes)).toBe("archive-bytes");
    expect(await client.getFile(id)).toMatchObject({ size: 13, trashed: false });
    const start = drive.requests.find((r) => r.url.includes("uploadType=resumable"));
    expect(start?.body).not.toContain("permissions");
  });

  it("M7.3-5: a 503 during upload is retried; a 400 is not", async () => {
    const drive = createFakeDrive();
    const client = createDriveClient("token", drive.fetch, noSleep);
    const file = archive("x");
    drive.failNext("upload", { status: 503, body: {} });
    await expect(client.uploadFile("folder1", "n", file, 1, {})).resolves.toMatch(/^id/);
    drive.failNext("uploadStart", { status: 400, body: { error: { status: "INVALID_ARGUMENT" } } });
    await expect(client.uploadFile("folder1", "n", file, 1, {})).rejects.toThrow(
      "Drive upload start failed: HTTP 400 (INVALID_ARGUMENT)",
    );
    drive.failNext("upload", { status: 500, body: {} }, 3);
    await expect(client.uploadFile("folder1", "n", file, 1, {})).rejects.toThrow("HTTP 500");
  });

  it("M7.3-4: delete removes the file and tolerates one already gone", async () => {
    const drive = createFakeDrive();
    const client = createDriveClient("token", drive.fetch, noSleep);
    const file = drive.addFile({ name: "x", mimeType: "a", parents: [], appProperties: {} });
    await client.deleteFile(file.id);
    expect(drive.files.has(file.id)).toBe(false);
    await expect(client.deleteFile(file.id)).resolves.toBeUndefined();
    drive.failNext("delete", { status: 403, body: { error: { status: "PERMISSION_DENIED" } } });
    await expect(client.deleteFile("id9999")).rejects.toThrow("HTTP 403");
  });

  it("M7.3-6: a network failure names the step only", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed: getaddrinfo oauth2.googleapis.com secret");
    }) as typeof fetch;
    await expect(getAccessToken(CREDENTIALS, failing)).rejects.toThrow(
      /^Google token refresh failed: network error$/,
    );
  });
});
