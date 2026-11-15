import type { User } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  LOGIN_PATH,
  UNAUTHORIZED_PATH,
  decideAdminAccess,
  decideUserAccess,
  type AccessDecision,
} from "./access";
import { fetchIsAdmin, fetchIsAllowedUser } from "./roles";

/**
 * The signed-in user, verified with the Supabase Auth server (`getUser`), never read from an
 * unverified cookie. Memoized for one server render. Any auth error counts as signed out, so
 * a failure can only deny access.
 */
export const getVerifiedUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }
  return data.user;
});

function enforce(decision: AccessDecision): void {
  switch (decision) {
    case "allow":
      return;
    case "login":
      redirect(LOGIN_PATH);
    case "unauthorized":
      // src/proxy.ts deletes the session before a page renders; this is defense in depth.
      redirect(UNAUTHORIZED_PATH);
    case "forbidden":
      // Admin-only screens are not revealed to the owner (AUTH-5).
      notFound();
  }
}

/**
 * AUTH-2 / AUTH-3: the access decision for the current request, from the verified user
 * (`getUser`) and `is_allowed_user()`. Memoized per render.
 */
export const getUserAccess = cache(
  async (): Promise<{ user: User | null; decision: AccessDecision }> => {
    const user = await getVerifiedUser();
    const isAllowed = user ? await fetchIsAllowedUser(await createSupabaseServerClient()) : false;
    return { user, decision: decideUserAccess({ hasUser: user !== null, isAllowed }) };
  },
);

/**
 * AUTH-2 / AUTH-3: returns the user of a valid, allowlisted session, or redirects. Call it at
 * the top of every protected page, Server Function and Route Handler: `await
 * requireAllowedUser()`. Memoized per render, so calling it from a layout and a page costs
 * one check.
 */
export const requireAllowedUser = cache(async (): Promise<User> => {
  const { user, decision } = await getUserAccess();
  enforce(decision);
  return user as User; // enforce() redirected unless the user exists and is allowed.
});

/**
 * AUTH-5: returns the user of a valid admin session. Owners get the 404 screen, visitors
 * without an allowlisted session are redirected. Call it at the top of every admin-only
 * page, Server Function and Route Handler.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getVerifiedUser();
  let isAllowed = false;
  let isAdmin = false;
  if (user) {
    const supabase = await createSupabaseServerClient();
    [isAllowed, isAdmin] = await Promise.all([
      fetchIsAllowedUser(supabase),
      fetchIsAdmin(supabase),
    ]);
  }
  enforce(decideAdminAccess({ hasUser: user !== null, isAllowed, isAdmin }));
  return user as User; // enforce() redirected or threw unless the user is an admin.
}
