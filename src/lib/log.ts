/**
 * Logs a failed database operation by its Postgres error code only: Postgres error details
 * and messages can contain row values, which are personal data (SPEC 8).
 */
export function logDbFailure(scope: string, operation: string, error: unknown): void {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "none";
  console.error(`${scope}: ${operation} failed (code ${code})`);
}
