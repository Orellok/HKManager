import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeOwnerOnlyFile } from "./owner-only-file.mts";

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-only-"));
  dirs.push(dir);
  return join(dir, "secret.local");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("M7.3-12: owner-only secret files", () => {
  it("M7.3-12: a new file is created with mode 0600", () => {
    const file = tempFile();
    writeOwnerOnlyFile(file, "A=1\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("A=1\n");
  });

  it("M7.3-12: replacing a world-readable file (--force) narrows it to 0600", () => {
    const file = tempFile();
    writeFileSync(file, "old\n", { mode: 0o644 });
    writeOwnerOnlyFile(file, "new\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe("new\n");
  });

  it("M7.3-12: the new content is never written into the old, wider-mode file", () => {
    const file = tempFile();
    writeFileSync(file, "old\n", { mode: 0o644 });
    // A second name for the old file: it must still hold only the old content.
    const oldInode = `${file}.old`;
    linkSync(file, oldInode);
    writeOwnerOnlyFile(file, "secret\n");
    expect(readFileSync(oldInode, "utf8")).toBe("old\n");
    expect(statSync(file).ino).not.toBe(statSync(oldInode).ino);
    expect(readFileSync(file, "utf8")).toBe("secret\n");
  });

  it("M7.3-12: no temporary file is left behind, also when the write fails", () => {
    const file = tempFile();
    writeOwnerOnlyFile(file, "A=1\n");
    const dir = file.slice(0, file.lastIndexOf("/"));
    expect(readdirSync(dir)).toEqual(["secret.local"]);
    const blocked = join(dir, "is-a-dir");
    mkdirSync(blocked);
    expect(() => writeOwnerOnlyFile(blocked, "x")).toThrow();
    expect(readdirSync(dir).sort()).toEqual(["is-a-dir", "secret.local"]);
  });
});
