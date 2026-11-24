/** The backup's manifest.json, checksums and row counts (M7.3-2, 10). */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { z } from "zod";

import { BackupError } from "./backup-error.mts";

export const MANIFEST_FORMAT = 1;
export const DATA_FILE = "db/data.sql";
export const SCHEMA_FILE = "db/schema.sql";
export const MANIFEST_FILE = "manifest.json";

const BUCKET = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,62}$/;
const TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COPY_LINE = /^COPY "([a-z_][a-z0-9_]*)"\."([a-z_][a-z0-9_]*)" \(.*\) FROM stdin;$/;
const COPY_END = "\\.";

/** A Storage object path we can store as a file: no empty, "." or ".." segment. */
export function isSafeObjectPath(path: string): boolean {
  if (path === "" || path.length > 1024 || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isSafeBucket(bucket: string): boolean {
  return BUCKET.test(bucket) && bucket !== "." && bucket !== "..";
}

const fileEntry = z.object({
  path: z.enum([DATA_FILE, SCHEMA_FILE]),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256),
});

const objectEntry = z.object({
  bucket: z.string().refine(isSafeBucket),
  path: z.string().refine(isSafeObjectPath),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(SHA256),
  contentType: z.string().min(1).max(255),
});

const manifestSchema = z.object({
  format: z.literal(MANIFEST_FORMAT),
  environment: z.enum(["production", "staging", "local"]),
  createdAt: z.iso.datetime(),
  commit: z.string().regex(/^([0-9a-f]{40}|unknown)$/),
  latestMigration: z.string().regex(/^(\d{14}|none)$/),
  database: z.object({
    files: z.array(fileEntry).length(2),
    rowCounts: z.record(z.string().regex(TABLE), z.number().int().nonnegative()),
  }),
  storage: z.object({ objects: z.array(objectEntry) }),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type FileEntry = z.infer<typeof fileEntry>;
export type StorageObjectEntry = z.infer<typeof objectEntry>;

export function parseManifest(text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError("manifest.json is not valid JSON");
  }
  const result = manifestSchema.safeParse(json);
  if (!result.success) {
    throw new BackupError("manifest.json does not match the backup format");
  }
  return result.data;
}

/** Counts the rows of each COPY block (pg_dump text format: one row per line). */
export function createCopyRowCounter() {
  const counts: Record<string, number> = {};
  let current: string | null = null;
  return {
    line(text: string) {
      if (current === null) {
        const copy = COPY_LINE.exec(text);
        if (copy) {
          current = `${copy[1]}.${copy[2]}`;
          counts[current] = 0;
        }
      } else if (text === COPY_END) {
        current = null;
      } else {
        counts[current] += 1;
      }
    },
    result(): Record<string, number> {
      if (current !== null) {
        throw new BackupError("Database dump is truncated (unfinished COPY block)");
      }
      return counts;
    },
  };
}

export async function countCopyRowsInFile(path: string): Promise<Record<string, number>> {
  const counter = createCopyRowCounter();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    counter.line(line);
  }
  return counter.result();
}

export async function hashFile(
  path: string,
  algorithm: "sha256" | "md5",
): Promise<{ digest: string; bytes: number }> {
  const hash = createHash(algorithm);
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { digest: hash.digest("hex"), bytes };
}

export function quoteTable(table: string): string {
  if (!TABLE.test(table)) {
    throw new BackupError("Unexpected table name in the manifest");
  }
  const [schema, name] = table.split(".");
  return `"${schema}"."${name}"`;
}
