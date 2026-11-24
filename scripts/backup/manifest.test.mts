import { describe, expect, it } from "vitest";

import {
  createCopyRowCounter,
  isSafeBucket,
  isSafeObjectPath,
  parseManifest,
  quoteTable,
  type Manifest,
} from "./manifest.mts";

const SHA = "a".repeat(64);
const VALID: Manifest = {
  format: 1,
  environment: "production",
  createdAt: "2026-11-28T02:41:07.000Z",
  commit: "b".repeat(40),
  latestMigration: "20261130090000",
  database: {
    files: [
      { path: "db/data.sql", bytes: 10, sha256: SHA },
      { path: "db/schema.sql", bytes: 5, sha256: SHA },
    ],
    rowCounts: { "public.clients": 3, "auth.users": 2 },
  },
  storage: {
    objects: [
      {
        bucket: "receipts",
        path: "inc/abc.pdf",
        bytes: 4,
        sha256: SHA,
        contentType: "application/pdf",
      },
    ],
  },
};

describe("M7.3-2: manifest and row counts", () => {
  it("M7.3-2: counts rows per COPY block of a pg_dump data file", () => {
    const counter = createCopyRowCounter();
    for (const line of [
      "SET session_replication_role = replica;",
      'COPY "public"."clients" ("id", "name") FROM stdin;',
      "1\tA",
      "2\tB\\nwith escaped newline",
      "\\.",
      'COPY "auth"."users" ("id") FROM stdin;',
      "\\.",
      "SELECT pg_catalog.setval('x', 1, true);",
    ]) {
      counter.line(line);
    }
    expect(counter.result()).toEqual({ "public.clients": 2, "auth.users": 0 });
  });

  it("M7.3-5: a dump cut off inside a COPY block fails", () => {
    const counter = createCopyRowCounter();
    counter.line('COPY "public"."clients" ("id") FROM stdin;');
    counter.line("1");
    expect(() => counter.result()).toThrow(/truncated/);
  });

  it("M7.3-10: a valid manifest parses; tampered ones are refused", () => {
    expect(parseManifest(JSON.stringify(VALID))).toEqual(VALID);
    for (const bad of [
      { ...VALID, format: 2 },
      { ...VALID, database: { ...VALID.database, rowCounts: { "public.x; drop": 1 } } },
      { ...VALID, storage: { objects: [{ ...VALID.storage.objects[0], path: "../etc/passwd" }] } },
      { ...VALID, storage: { objects: [{ ...VALID.storage.objects[0], bucket: ".." }] } },
    ]) {
      expect(() => parseManifest(JSON.stringify(bad))).toThrow(/backup format/);
    }
    expect(() => parseManifest("{")).toThrow(/not valid JSON/);
  });

  it("M7.3-2: object paths and buckets that could leave the backup folder are unsafe", () => {
    expect(isSafeObjectPath("a/b/c.pdf")).toBe(true);
    for (const path of ["", "/abs", "a//b", "a/../b", "./a", "a\\b", "a/"]) {
      expect(isSafeObjectPath(path), path).toBe(false);
    }
    expect(isSafeBucket("expense-files")).toBe(true);
    expect(isSafeBucket("..")).toBe(false);
    expect(isSafeBucket("a/b")).toBe(false);
  });

  it("M7.3-10: table names are quoted only when they are plain identifiers", () => {
    expect(quoteTable("public.clients")).toBe('"public"."clients"');
    expect(() => quoteTable('public."x"')).toThrow();
  });
});
