import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnv } from "./env";

/** Supabase client for Client Components. Stores the session in cookies the server can read. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient(url, anonKey);
}
