import type { SupabaseClient } from "@supabase/supabase-js";

type RoleHelper = "is_allowed_user" | "is_admin";

/**
 * Calls one of the SQL authorization helpers (M0.2 migration) with the caller's session.
 * The database decides from the verified JWT; an error is thrown rather than read as "no".
 */
async function callRoleHelper(client: SupabaseClient, helper: RoleHelper): Promise<boolean> {
  const { data, error } = await client.rpc(helper);
  if (error) {
    throw new Error(`Could not check ${helper}`, { cause: error });
  }
  return data === true;
}

/** AUTH-2: is the signed-in user on the allowlist? */
export function fetchIsAllowedUser(client: SupabaseClient): Promise<boolean> {
  return callRoleHelper(client, "is_allowed_user");
}

/** AUTH-5: is the signed-in user an allowlisted admin? */
export function fetchIsAdmin(client: SupabaseClient): Promise<boolean> {
  return callRoleHelper(client, "is_admin");
}
