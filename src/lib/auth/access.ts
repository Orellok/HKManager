/**
 * Access decisions (SPEC 5.1). Pure functions, shared by src/proxy.ts and the server guards,
 * so the rules live in one place and are unit tested.
 */

export const LOGIN_PATH = "/login";
export const UNAUTHORIZED_PATH = "/unauthorized";
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const HOME_PATH = "/";

/** AUTH-3: the only routes reachable without a valid, allowlisted session. Exact matches. */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  LOGIN_PATH,
  UNAUTHORIZED_PATH,
  AUTH_CALLBACK_PATH,
  "/robots.txt",
]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export type AccessDecision =
  /** Let the request through. */
  | "allow"
  /** No valid session: send the visitor to the login screen. */
  | "login"
  /** Valid session of an account outside the allowlist: delete the session, show "אין הרשאה". */
  | "unauthorized"
  /** Allowlisted, but the resource needs the admin role (AUTH-5). */
  | "forbidden";

export type AccessFacts = {
  hasUser: boolean;
  /** Result of is_allowed_user(); only meaningful when hasUser is true. */
  isAllowed: boolean;
};

/** AUTH-2 / AUTH-3: may this visitor use a protected route? */
export function decideUserAccess({ hasUser, isAllowed }: AccessFacts): AccessDecision {
  if (!hasUser) {
    return "login";
  }
  return isAllowed ? "allow" : "unauthorized";
}

/** AUTH-5: may this visitor use an admin-only route? */
export function decideAdminAccess(facts: AccessFacts & { isAdmin: boolean }): AccessDecision {
  const userDecision = decideUserAccess(facts);
  if (userDecision !== "allow") {
    return userDecision;
  }
  return facts.isAdmin ? "allow" : "forbidden";
}
