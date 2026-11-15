import { NextResponse, type NextRequest } from "next/server";

import { HOME_PATH, LOGIN_PATH, UNAUTHORIZED_PATH } from "@/lib/auth/access";
import { SIGN_IN_ERROR_PARAM, SIGN_IN_ERROR_VALUE } from "@/lib/auth/sign-in-error";
import { fetchIsAllowedUser } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.url));
}

function signInFailed(request: NextRequest): NextResponse {
  return redirectTo(request, `${LOGIN_PATH}?${SIGN_IN_ERROR_PARAM}=${SIGN_IN_ERROR_VALUE}`);
}

/**
 * AUTH-1: Google OAuth callback (PKCE). Supabase Auth redirects here with `?code=` after a
 * successful Google sign-in, or with `?error=` when the sign-in failed or the before-user-created
 * hook rejected an account outside the allowlist.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return signInFailed(request);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return signInFailed(request);
  }

  // AUTH-2 defense in depth: the hook blocks new accounts, but an existing account may have
  // been removed from the allowlist since it was created.
  if (!(await fetchIsAllowedUser(supabase))) {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    if (signOutError) {
      throw new Error("Could not delete the session of a non-allowlisted account", {
        cause: signOutError,
      });
    }
    return redirectTo(request, UNAUTHORIZED_PATH);
  }

  return redirectTo(request, HOME_PATH);
}
