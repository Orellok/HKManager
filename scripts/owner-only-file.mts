import { randomBytes } from "node:crypto";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const OWNER_READ_WRITE = 0o600;

/**
 * Writes a secret file readable by the owner only. The content goes into a new file created
 * with mode 0600 in the same folder, which then replaces the target, so the secret is never
 * in a file with a wider mode (an existing target from a `--force` run keeps its old mode
 * only for its old content).
 */
export function writeOwnerOnlyFile(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(temporary, content, { mode: OWNER_READ_WRITE, flag: "wx" });
    chmodSync(temporary, OWNER_READ_WRITE);
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
