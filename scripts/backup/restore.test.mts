import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { hashFile, type Manifest } from "./manifest.mts";
import {
  buildPrelude,
  buildRowCountCheck,
  extractArchive,
  pgEnvFromUrl,
  restoreStorage,
  verifyChecksums,
} from "./restore.mts";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "restore-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function backupDir(): Promise<{ dir: string; manifest: Manifest }> {
  const dir = tempDir();
  mkdirSync(join(dir, "db"));
  mkdirSync(join(dir, "storage", "receipts", "inc"), { recursive: true });
  writeFileSync(
    join(dir, "db", "data.sql"),
    'COPY "public"."clients" ("id") FROM stdin;\n1\n\\.\n',
  );
  writeFileSync(join(dir, "db", "schema.sql"), "-- schema\n");
  writeFileSync(join(dir, "storage", "receipts", "inc", "a.pdf"), "%PDF");
  const entry = async (path: "db/data.sql" | "db/schema.sql") => {
    const { digest, bytes } = await hashFile(join(dir, path), "sha256");
    return { path, bytes, sha256: digest };
  };
  const object = await hashFile(join(dir, "storage", "receipts", "inc", "a.pdf"), "sha256");
  const manifest: Manifest = {
    format: 1,
    environment: "local",
    createdAt: "2026-11-28T02:41:07.000Z",
    commit: "unknown",
    latestMigration: "20261130090000",
    database: {
      files: [await entry("db/data.sql"), await entry("db/schema.sql")],
      rowCounts: { "public.clients": 1 },
    },
    storage: {
      objects: [
        {
          bucket: "receipts",
          path: "inc/a.pdf",
          bytes: object.bytes,
          sha256: object.digest,
          contentType: "application/pdf",
        },
      ],
    },
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return { dir, manifest };
}

describe("M7.3-10: restore checks", () => {
  it("M7.3-10: the prelude refuses a target with data, except the migrations' seed tables", () => {
    const sql = buildPrelude(
      { "public.clients": 3, "public.app_settings": 4, "auth.users": 1 },
      false,
    );
    expect(sql).toContain('exists (select 1 from "public"."clients")');
    expect(sql).toContain('exists (select 1 from "auth"."users")');
    expect(sql).not.toContain('exists (select 1 from "public"."app_settings")');
    expect(sql).toContain("errcode = 'HKR01'");
    expect(sql).toContain(
      'delete from "auth"."users";\ndelete from "public"."app_settings";\ndelete from "public"."clients";',
    );
    expect(sql.startsWith("set session_replication_role = replica;")).toBe(true);
  });

  it("M7.3-10: --replace skips the refusal but still empties the dumped tables first", () => {
    const sql = buildPrelude({ "public.clients": 3 }, true);
    expect(sql).not.toContain("HKR01");
    expect(sql).toContain('delete from "public"."clients";');
  });

  it("M7.3-10: the row-count check compares every table with the manifest", () => {
    const sql = buildRowCountCheck({ "public.clients": 3, "auth.users": 0 });
    expect(sql).toContain('select count(*) into n from "auth"."users";\n  if n <> 0 then');
    expect(sql).toContain('select count(*) into n from "public"."clients";\n  if n <> 3 then');
    expect(sql).toContain("errcode = 'HKR02'");
    expect(() => buildRowCountCheck({ "public.x": -1 })).toThrow();
  });

  it("M7.3-10: the database URL becomes libpq variables (no password in arguments)", () => {
    expect(
      pgEnvFromUrl(
        "postgresql://postgres.ref:p%40ss@aws-0.pooler.supabase.com:5432/postgres?sslmode=require",
      ),
    ).toEqual({
      PGHOST: "aws-0.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "postgres.ref",
      PGPASSWORD: "p@ss",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
    expect(() => pgEnvFromUrl("https://x")).toThrow(/postgres/);
    expect(() => pgEnvFromUrl("nonsense")).toThrow(/postgres/);
  });

  it("M7.3-10: an archive unpacks and its checksums verify; any changed byte is refused", async () => {
    const { dir, manifest } = await backupDir();
    const archive = join(tempDir(), "b.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", dir, "manifest.json", "db", "storage"]);
    const target = tempDir();
    expect(await extractArchive(archive, target)).toEqual(manifest);
    await expect(verifyChecksums(target, manifest)).resolves.toBeUndefined();
    writeFileSync(join(target, "storage", "receipts", "inc", "a.pdf"), "%PDX");
    await expect(verifyChecksums(target, manifest)).rejects.toThrow(
      "Checksum mismatch: Storage object #1 in receipts",
    );
    writeFileSync(join(target, "db", "data.sql"), "changed");
    await expect(verifyChecksums(target, manifest)).rejects.toThrow(
      "Checksum mismatch: db/data.sql",
    );
  });
});

function pack(dir: string): string {
  const archive = join(tempDir(), "b.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", dir, "manifest.json", "db", "storage"]);
  return archive;
}

describe("M7.3-10: archive entries must be regular files", () => {
  it("M7.3-10: a symlinked Storage object is refused before anything is read", async () => {
    const { dir } = await backupDir();
    const outside = join(tempDir(), "secret.txt");
    writeFileSync(outside, "%PDF");
    const object = join(dir, "storage", "receipts", "inc", "a.pdf");
    unlinkSync(object);
    symlinkSync(outside, object);
    const target = tempDir();
    const manifest = await extractArchive(pack(dir), target);
    await expect(verifyChecksums(target, manifest)).rejects.toThrow(
      "The archive holds Storage object #1 in receipts that is not a regular file; refused",
    );
  });

  it("M7.3-10: a symlinked folder on the way to an object is refused", async () => {
    const { dir } = await backupDir();
    const outside = tempDir();
    mkdirSync(join(outside, "inc"));
    writeFileSync(join(outside, "inc", "a.pdf"), "%PDF");
    rmSync(join(dir, "storage", "receipts"), { recursive: true });
    symlinkSync(outside, join(dir, "storage", "receipts"));
    const target = tempDir();
    const manifest = await extractArchive(pack(dir), target);
    await expect(verifyChecksums(target, manifest)).rejects.toThrow(/not a regular file; refused/);
  });

  it("M7.3-10: a symlinked or hard-linked db/data.sql is refused", async () => {
    for (const kind of ["symlink", "hardlink"] as const) {
      const { dir } = await backupDir();
      const data = join(dir, "db", "data.sql");
      const copy = join(dir, "db", "copy.sql");
      writeFileSync(copy, readFileSync(data));
      unlinkSync(data);
      if (kind === "symlink") {
        symlinkSync(copy, data);
      } else {
        linkSync(copy, data);
      }
      const target = tempDir();
      const manifest = await extractArchive(pack(dir), target);
      await expect(verifyChecksums(target, manifest), kind).rejects.toThrow(
        "The archive holds db/data.sql that is not a regular file; refused",
      );
    }
  });

  it("M7.3-10: a symlinked manifest.json is refused before it is parsed", async () => {
    const { dir } = await backupDir();
    const real = join(tempDir(), "manifest.json");
    writeFileSync(real, readFileSync(join(dir, "manifest.json")));
    unlinkSync(join(dir, "manifest.json"));
    symlinkSync(real, join(dir, "manifest.json"));
    await expect(extractArchive(pack(dir), tempDir())).rejects.toThrow(
      "The archive holds manifest.json that is not a regular file; refused",
    );
  });

  it("M7.3-10: a missing object file is refused", async () => {
    const { dir } = await backupDir();
    unlinkSync(join(dir, "storage", "receipts", "inc", "a.pdf"));
    const target = tempDir();
    const manifest = await extractArchive(pack(dir), target);
    await expect(verifyChecksums(target, manifest)).rejects.toThrow(
      "The archive is missing Storage object #1 in receipts",
    );
  });
});

/** A Storage API that keeps uploads and serves them back, optionally changed or lost. */
function fakeTarget(mode: "ok" | "changed" | "lost") {
  const stored = new Map<string, Buffer>();
  const fetchFn = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    if (init.method === "POST") {
      stored.set(path, Buffer.from(await new Response(init.body as Blob).arrayBuffer()));
      return new Response("{}");
    }
    const bytes = stored.get(path);
    if (!bytes || mode === "lost") {
      return new Response(JSON.stringify({ error: "not_found" }), { status: 400 });
    }
    const served = mode === "changed" ? Buffer.concat([bytes, Buffer.from([1])]) : bytes;
    return new Response(new Uint8Array(served));
  }) as typeof fetch;
  return { apiUrl: "http://target", serviceKey: "k", fetch: fetchFn };
}

describe("M7.3-10: Storage restore is read back", () => {
  it("M7.3-10: objects that read back with the manifest's SHA-256 pass", async () => {
    const { dir, manifest } = await backupDir();
    await expect(restoreStorage(dir, manifest, fakeTarget("ok"))).resolves.toBeUndefined();
  });

  it("M7.3-10: a changed or missing object in the target fails the restore", async () => {
    for (const mode of ["changed", "lost"] as const) {
      const { dir, manifest } = await backupDir();
      await expect(restoreStorage(dir, manifest, fakeTarget(mode)), mode).rejects.toThrow(
        "Storage check failed: 1 of 1 objects missing or different in the target",
      );
    }
  });
});
