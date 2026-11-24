import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
});
