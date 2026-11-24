import { chmodSync, writeFileSync } from "node:fs";

const OWNER_READ_WRITE = 0o600;

/**
 * Writes a secret file readable by the owner only. `mode` applies only when the file is
 * created, so a file that already existed (a `--force` run) is narrowed explicitly too.
 */
export function writeOwnerOnlyFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: OWNER_READ_WRITE });
  chmodSync(path, OWNER_READ_WRITE);
}
