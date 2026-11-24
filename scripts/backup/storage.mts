/** Storage export and restore through the Storage API with a service key (M7.3-2, 10). */
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, openAsBlob } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import { BackupError, httpFailure, safeCode } from "./backup-error.mts";
import type { Fetch } from "./google-drive.mts";
import { isSafeBucket, isSafeObjectPath, type StorageObjectEntry } from "./manifest.mts";

const LIST_PAGE = 1000;
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export type StorageTarget = { apiUrl: string; serviceKey: string; fetch?: Fetch };

/** New `sb_secret_` keys go in `apikey` only; a legacy service_role JWT also as Bearer. */
function headers(target: StorageTarget): Record<string, string> {
  return target.serviceKey.startsWith("sb_secret_")
    ? { apikey: target.serviceKey }
    : { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` };
}

function objectUrl(target: StorageTarget, bucket: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${target.apiUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`;
}

async function storageCall(
  target: StorageTarget,
  step: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await (target.fetch ?? fetch)(url, {
      ...init,
      headers: { ...headers(target), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new BackupError(`${step} failed: network error`);
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      code = safeCode(((await response.json()) as { error?: unknown }).error);
    } catch {
      // No code to report.
    }
    throw httpFailure(step, response.status, code);
  }
  return response;
}

export async function listBuckets(target: StorageTarget): Promise<string[]> {
  const response = await storageCall(
    target,
    "Storage bucket listing",
    `${target.apiUrl}/storage/v1/bucket`,
  );
  const buckets = (await response.json()) as { id?: unknown }[];
  return buckets.map(({ id }) => {
    if (typeof id !== "string" || !isSafeBucket(id)) {
      throw new BackupError("Storage bucket listing failed: unsupported bucket name");
    }
    return id;
  });
}

type ListedObject = { path: string; contentType: string };

/** Every object of a bucket; entries without an id are folders and are listed recursively. */
export async function listObjects(target: StorageTarget, bucket: string): Promise<ListedObject[]> {
  const found: ListedObject[] = [];
  const prefixes = [""];
  while (prefixes.length > 0) {
    const prefix = prefixes.shift() as string;
    for (let offset = 0; ; offset += LIST_PAGE) {
      const response = await storageCall(
        target,
        "Storage object listing",
        `${target.apiUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prefix,
            limit: LIST_PAGE,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        },
      );
      const entries = (await response.json()) as {
        name?: unknown;
        id?: unknown;
        metadata?: { mimetype?: unknown } | null;
      }[];
      for (const entry of entries) {
        if (typeof entry.name !== "string") {
          throw new BackupError("Storage object listing failed: unexpected response");
        }
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.id === null || entry.id === undefined) {
          prefixes.push(path);
          continue;
        }
        const mimetype = entry.metadata?.mimetype;
        found.push({
          path,
          contentType:
            typeof mimetype === "string" && mimetype !== "" ? mimetype : DEFAULT_CONTENT_TYPE,
        });
      }
      if (entries.length < LIST_PAGE) {
        break;
      }
    }
  }
  return found;
}

/** Where an object is kept inside the backup; refuses names that could leave the folder. */
export function objectFilePath(root: string, bucket: string, path: string): string {
  if (!isSafeBucket(bucket) || !isSafeObjectPath(path)) {
    throw new BackupError("Storage object with an unsupported name; backup stopped");
  }
  const base = resolve(root);
  const file = resolve(base, bucket, ...path.split("/"));
  if (!file.startsWith(base + sep)) {
    throw new BackupError("Storage object with an unsupported name; backup stopped");
  }
  return file;
}

export async function downloadObject(
  target: StorageTarget,
  bucket: string,
  path: string,
  file: string,
): Promise<{ bytes: number; sha256: string }> {
  const response = await storageCall(target, "Storage download", objectUrl(target, bucket, path));
  if (!response.body) {
    throw new BackupError("Storage download failed: empty response");
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const hash = createHash("sha256");
  let bytes = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    measure,
    createWriteStream(file, { mode: 0o600 }),
  );
  return { bytes, sha256: hash.digest("hex") };
}

/** Downloads every object of every bucket under `<root>/<bucket>/<path>`. */
export async function exportStorage(
  target: StorageTarget,
  root: string,
): Promise<StorageObjectEntry[]> {
  const objects: StorageObjectEntry[] = [];
  for (const bucket of await listBuckets(target)) {
    for (const { path, contentType } of await listObjects(target, bucket)) {
      const { bytes, sha256 } = await downloadObject(
        target,
        bucket,
        path,
        objectFilePath(root, bucket, path),
      );
      objects.push({ bucket, path, bytes, sha256, contentType });
    }
  }
  return objects;
}

/** Uploads one object, replacing an existing one at the same path. */
export async function uploadObject(
  target: StorageTarget,
  object: StorageObjectEntry,
  root: string,
): Promise<void> {
  const file = objectFilePath(root, object.bucket, object.path);
  await storageCall(
    target,
    `Storage upload to bucket ${object.bucket}`,
    objectUrl(target, object.bucket, object.path),
    {
      method: "POST",
      headers: { "Content-Type": object.contentType, "x-upsert": "true" },
      body: await openAsBlob(file),
    },
  );
}

/**
 * Downloads every listed object from the target into `dir` and counts the ones that are
 * missing or whose SHA-256 differs from the manifest.
 */
export async function countUnmatchedObjects(
  target: StorageTarget,
  objects: StorageObjectEntry[],
  dir: string,
): Promise<number> {
  let unmatched = 0;
  for (const [index, object] of objects.entries()) {
    try {
      const { sha256 } = await downloadObject(
        target,
        object.bucket,
        object.path,
        resolve(dir, `object-${index}`),
      );
      if (sha256 !== object.sha256) {
        unmatched += 1;
      }
    } catch {
      unmatched += 1;
    }
  }
  return unmatched;
}
