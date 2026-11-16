import { isAuthRetryableFetchError } from "@supabase/supabase-js";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import { LOGIN_PATH } from "./access";

export type SessionState = "valid" | "ended" | "unknown";

/**
 * Asks the Supabase Auth server whether the browser's session is still valid (getUser
 * verifies it, refreshing an expired access token first). A failed request, e.g. no
 * connection, gives "unknown" rather than a guess.
 */
export async function checkBrowserSession(): Promise<SessionState> {
  try {
    const { data, error } = await createSupabaseBrowserClient().auth.getUser();
    if (data.user) {
      return "valid";
    }
    return isAuthRetryableFetchError(error) ? "unknown" : "ended";
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
