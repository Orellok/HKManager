/**
 * An error whose message is safe for the public Actions log (M7.3-6): it never carries a
 * response body, an object path, personal data or a token.
 */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupError";
  }
}

const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** Keeps an API error code only when it is a plain identifier (e.g. `invalid_grant`). */
export function safeCode(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE.test(value) ? value : null;
}

/** "<step> failed: HTTP 403 (insufficientPermissions)" – status and code only. */
export function httpFailure(step: string, status: number, code: string | null): BackupError {
  return new BackupError(`${step} failed: HTTP ${status}${code ? ` (${code})` : ""}`);
}

/** For errors that are not BackupError: their name and system code only, never the message. */
export function describeUnexpected(error: unknown): string {
  if (error instanceof BackupError) {
    return error.message;
  }
  const name = error instanceof Error ? error.name : typeof error;
  const code = safeCode((error as { code?: unknown } | null)?.code);
  return `unexpected ${name}${code ? ` (${code})` : ""}; details hidden`;
}
