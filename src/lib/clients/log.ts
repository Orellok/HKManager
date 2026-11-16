/**
 * Logs a failed clients operation by its Postgres error code only: Postgres error details
 * and messages can contain row values, which are personal data (SPEC 8).
 */
export function logClientFailure(operation: string, error: unknown): void {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "none";
  console.error(`clients: ${operation} failed (code ${code})`);
}
