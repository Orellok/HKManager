import { isAuthApiError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { LOGIN_PATH } from "./access";

export type SessionState = "valid" | "ended" | "unknown";

/** HTTP statuses with which the Auth server rejects a session that is no longer valid. */
const SESSION_REJECTED_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * The session state from the answer of `auth.getUser()`. Only an answer that proves the
 * session is gone counts as "ended": no session at all, or the Auth server rejecting it with
 * 401/403. Anything else (no connection, rate limiting with 429, a server error) is
 * "unknown", so a temporary failure never signs the user out.
 */
export function sessionStateFrom({
  user,
  error,
}: {
  user: User | null;
  error: unknown;
}): SessionState {
  if (user) {
    return "valid";
  }
  if (isAuthSessionMissingError(error)) {
    return "ended";
  }
  if (isAuthApiError(error) && SESSION_REJECTED_STATUSES.has(error.status)) {
    return "ended";
  }
  return "unknown";
}

/**
 * Asks the Supabase Auth server whether the browser's session is still valid (getUser
 * verifies it, refreshing an expired access token first).
 */
export async function checkBrowserSession(): Promise<SessionState> {
  try {
    const { data, error } = await createSupabaseBrowserClient().auth.getUser();
    return sessionStateFrom({ user: data.user, error });
  } catch {
    return "unknown";
  }
}

/**
 * For the catch of a failed Server Action request in the browser. When the session has
 * ended (the proxy answered the action with a redirect to /login, which is not an action
 * response), retrying cannot succeed, so the user goes to the login screen with a full
 * navigation. Returns true in that case; otherwise the caller shows its inline error.
 * Callers call unstable_rethrow(error) first, so Next.js redirects never reach here.
 */
export async function redirectToLoginIfSessionEnded(): Promise<boolean> {
  if ((await checkBrowserSession()) !== "ended") {
    return false;
  }
  window.location.replace(LOGIN_PATH);
  return true;
}

export type ServerActionCall<T> =
  | { status: "done"; value: T }
  /** The request failed (no connection, server error); the caller shows its inline error. */
  | { status: "failed" }
  /** The session had ended; the browser is on its way to /login, so show nothing. */
  | { status: "redirected" };

/**
 * Calls a Server Action from the browser and turns a thrown request failure into a result.
 * A Next.js redirect or notFound from the action is rethrown so the router handles it.
 */
export async function callServerAction<T>(call: () => Promise<T>): Promise<ServerActionCall<T>> {
  try {
    return { status: "done", value: await call() };
  } catch (error) {
    unstable_rethrow(error);
    return (await redirectToLoginIfSessionEnded())
      ? { status: "redirected" }
      : { status: "failed" };
  }
}
