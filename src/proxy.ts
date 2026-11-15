import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_PATH, UNAUTHORIZED_PATH, decideUserAccess, isPublicPath } from "@/lib/auth/access";
import { fetchIsAllowedUser } from "@/lib/auth/roles";
import {
  NONCE_REQUEST_HEADER,
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/security-headers";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

const CSP_HEADER = "Content-Security-Policy";

type PendingCookie = { name: string; value: string; options: CookieOptions };

/**
 * Runs before every page render:
 * 1. Builds the per-request nonce CSP (M0.1).
 * 2. Refreshes the Supabase session and writes the new cookies to the request and response.
 * 3. AUTH-3: redirects visitors without a verified session to /login on protected routes.
 * 4. AUTH-2: deletes the session of an account outside the allowlist and shows "אין הרשאה".
 */
export async function proxy(request: NextRequest) {
  const { url, anonKey } = getSupabasePublicEnv();
  const nonce = generateNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    supabaseUrl: url,
  });

  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          // Updates the request's Cookie header, so the page renders with the fresh session.
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push(cookie);
        }
        Object.assign(pendingHeaders, headers);
      },
    },
  });

  // getClaims() verifies the access token's signature (refreshing it first when expired);
  // it never trusts the cookie as is.
  const { data: claimsData } = await supabase.auth.getClaims();
  const hasUser = Boolean(claimsData?.claims.sub);

  let redirectPath: string | undefined;
  if (!isPublicPath(request.nextUrl.pathname)) {
    const isAllowed = hasUser ? await fetchIsAllowedUser(supabase) : false;
    const decision = decideUserAccess({ hasUser, isAllowed });
    if (decision === "login") {
      redirectPath = LOGIN_PATH;
    } else if (decision === "unauthorized") {
      // Revokes every session of this account and clears the auth cookies (via setAll).
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) {
        throw new Error("Could not delete the session of a non-allowlisted account", {
          cause: error,
        });
      }
      redirectPath = UNAUTHORIZED_PATH;
    }
  }

  let response: NextResponse;
  if (redirectPath) {
    response = NextResponse.redirect(new URL(redirectPath, request.url));
  } else {
    // Next.js reads the nonce from the request's CSP header and applies it to its own scripts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(NONCE_REQUEST_HEADER, nonce);
    requestHeaders.set(CSP_HEADER, contentSecurityPolicy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set(CSP_HEADER, contentSecurityPolicy);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  // Cache-Control headers from @supabase/ssr keep responses that set auth cookies uncached.
  for (const [key, value] of Object.entries(pendingHeaders)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Static build assets carry no inline code and need no nonce.
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
