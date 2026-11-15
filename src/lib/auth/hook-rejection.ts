/**
 * The messages the before-user-created hook (supabase/migrations) returns when it refuses to
 * create an account. Supabase Auth forwards the message to the OAuth callback as
 * `error_description` (verified on GoTrue v2.197.0: `?error=access_denied&error_description=…`).
 * tests/integration/auth-hook.test.ts checks that these match the SQL function exactly.
 */
export const HOOK_REJECTION_MESSAGES = {
  notAllowed: "This account is not allowed to access the app.",
  googleOnly: "Sign-up is available with Google only.",
  emailNotVerified: "This account's email address is not verified.",
} as const;

const REJECTION_MESSAGES: ReadonlySet<string> = new Set(Object.values(HOOK_REJECTION_MESSAGES));

/** AUTH-2: did the callback error come from the hook refusing this account? */
export function isHookRejection(errorDescription: string | null): boolean {
  return errorDescription !== null && REJECTION_MESSAGES.has(errorDescription);
}
