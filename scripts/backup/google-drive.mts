/**
 * The Google Drive calls of the backup (M7.3-3, 4, 5), with Node's fetch only. Scope
 * `drive.file`: the app sees only the files and the folder it created itself.
 */
import { openAsBlob } from "node:fs";

import { BackupError, httpFailure, safeCode } from "./backup-error.mts";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const BACKUP_FOLDER_NAME = "HKManager backups";
export const BACKUP_APP_PROPERTY = "hkmanagerBackup";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const UPLOAD_SESSION_PREFIX = "https://www.googleapis.com/upload/";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ARCHIVE_MIME = "application/gzip";
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const LIST_PAGE_SIZE = 1000;
const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

export const REVOKED_TOKEN_MESSAGE =
  "Google refused the refresh token (invalid_grant): it was revoked or expired. " +
  "Re-run scripts/backup/get-drive-token.mts and update GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN " +
  "(docs/setup/backups.md).";

export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export type DriveCredentials = { clientId: string; clientSecret: string; refreshToken: string };
export type DriveFile = { id: string; name: string };
export type UploadedFile = { id: string; size: number; md5Checksum: string };

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      error?: string | { status?: string; errors?: { reason?: string }[] };
    };
    if (typeof body.error === "string") {
      return safeCode(body.error);
    }
    return safeCode(body.error?.errors?.[0]?.reason) ?? safeCode(body.error?.status);
  } catch {
    return null;
  }
}

/** fetch whose network failures say only which step failed. */
async function call(fetchFn: Fetch, step: string, url: string, init: RequestInit) {
  try {
    return await fetchFn(url, init);
  } catch {
    throw new BackupError(`${step} failed: network error`);
  }
}

async function readJson<T>(step: string, response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new BackupError(`${step} failed: unreadable response`);
  }
}

function driveId(step: string, value: unknown): string {
  if (typeof value !== "string" || !DRIVE_ID.test(value)) {
    throw new BackupError(`${step} failed: unexpected response`);
  }
  return value;
}

/** Exchanges a token request; `invalid_grant` gets the re-run instruction (M7.3-5). */
export async function requestToken(
  fetchFn: Fetch,
  step: string,
  form: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await call(fetchFn, step, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  if (!response.ok) {
    const code = await errorCode(response);
    if (code === "invalid_grant" && form.grant_type === "refresh_token") {
      throw new BackupError(REVOKED_TOKEN_MESSAGE);
    }
    throw httpFailure(step, response.status, code);
  }
  return readJson<Record<string, unknown>>(step, response);
}

export async function getAccessToken(
  credentials: DriveCredentials,
  fetchFn: Fetch = fetch,
): Promise<string> {
  const body = await requestToken(fetchFn, "Google token refresh", {
    grant_type: "refresh_token",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
  });
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new BackupError("Google token refresh failed: no access token");
  }
  return body.access_token;
}

export type DriveClient = ReturnType<typeof createDriveClient>;

export function createDriveClient(
  accessToken: string,
  fetchFn: Fetch = fetch,
  sleep: Sleep = defaultSleep,
) {
  const auth = { Authorization: `Bearer ${accessToken}` };

  async function driveCall(step: string, url: string, init: RequestInit = {}) {
    const response = await call(fetchFn, step, url, {
      ...init,
      headers: { ...auth, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok) {
      throw httpFailure(step, response.status, await errorCode(response));
    }
    return response;
  }

  async function listFiles(step: string, query: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: query,
        spaces: "drive",
        orderBy: "createdTime",
        pageSize: String(LIST_PAGE_SIZE),
        fields: "nextPageToken,files(id,name)",
      });
      if (pageToken) {
        params.set("pageToken", pageToken);
      }
      const response = await driveCall(step, `${FILES_URL}?${params}`);
      const body = await readJson<{ files?: unknown[]; nextPageToken?: unknown }>(step, response);
      for (const file of body.files ?? []) {
        const { id, name } = file as { id?: unknown; name?: unknown };
        files.push({ id: driveId(step, id), name: typeof name === "string" ? name : "" });
      }
      pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    } while (pageToken);
    return files;
  }

  /** The app's own backup folder: the oldest one with the name, created when there is none. */
  async function findOrCreateFolder(): Promise<string> {
    const step = "Drive folder lookup";
    const existing = await listFiles(
      step,
      `name = '${BACKUP_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    if (existing.length > 0) {
      return existing[0].id;
    }
    const response = await driveCall("Drive folder creation", `${FILES_URL}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    const body = await readJson<{ id?: unknown }>("Drive folder creation", response);
    return driveId("Drive folder creation", body.id);
  }

  async function uploadOnce(
    folderId: string,
    name: string,
    filePath: string,
    size: number,
    appProperties: Record<string, string>,
  ): Promise<string> {
    const init = await driveCall(
      "Drive upload start",
      `${UPLOAD_URL}?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": ARCHIVE_MIME,
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({ name, parents: [folderId], mimeType: ARCHIVE_MIME, appProperties }),
      },
    );
    const session = init.headers.get("location");
    if (!session || !session.startsWith(UPLOAD_SESSION_PREFIX)) {
      throw new BackupError("Drive upload start failed: no upload session");
    }
    const response = await driveCall("Drive upload", session, {
      method: "PUT",
      headers: { "Content-Type": ARCHIVE_MIME },
      body: await openAsBlob(filePath),
    });
    const body = await readJson<{ id?: unknown }>("Drive upload", response);
    return driveId("Drive upload", body.id);
  }

  /** Resumable upload; a network error, 429 or 5xx retries the whole upload. */
  async function uploadFile(
    folderId: string,
    name: string,
    filePath: string,
    size: number,
    appProperties: Record<string, string>,
  ): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await uploadOnce(folderId, name, filePath, size, appProperties);
      } catch (error) {
        const retryable =
          error instanceof BackupError &&
          /network error|HTTP (429|5\d\d)/.test(error.message) &&
          attempt < UPLOAD_ATTEMPTS;
        if (!retryable) {
          throw error;
        }
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  async function getFile(id: string): Promise<UploadedFile & { trashed: boolean }> {
    const step = "Drive upload check";
    const response = await driveCall(
      step,
      `${FILES_URL}/${driveId(step, id)}?fields=id,size,md5Checksum,trashed`,
    );
    const body = await readJson<Record<string, unknown>>(step, response);
    return {
      id: driveId(step, body.id),
      size: Number(body.size),
      md5Checksum: typeof body.md5Checksum === "string" ? body.md5Checksum : "",
      trashed: body.trashed === true,
    };
  }

  /** The app-created backup files in the folder (any environment). */
  async function listBackups(folderId: string): Promise<DriveFile[]> {
    const step = "Drive backup listing";
    return listFiles(
      step,
      `'${driveId(step, folderId)}' in parents and trashed = false and ` +
        `appProperties has { key='${BACKUP_APP_PROPERTY}' and value='1' }`,
    );
  }

  /** Permanent delete; a file that is already gone counts as deleted. */
  async function deleteFile(id: string): Promise<void> {
    const step = "Drive delete";
    const response = await call(fetchFn, step, `${FILES_URL}/${driveId(step, id)}`, {
      method: "DELETE",
      headers: auth,
    });
    if (!response.ok && response.status !== 404) {
      throw httpFailure(step, response.status, await errorCode(response));
    }
  }

  return { findOrCreateFolder, uploadFile, getFile, listBackups, deleteFile };
}
