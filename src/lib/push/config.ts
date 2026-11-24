import { getSupabasePublicEnv } from "@/lib/supabase/env";

import { isVapidPublicKey } from "./schema";

/**
 * M7.2: the public VAPID key (not secret; the private key exists only in the Edge Function's
 * secrets). Referenced literally so Next.js inlines it at build time; null when the
 * environment has no (valid) key yet, and the settings screen then says push is not set up.
 */
export function getVapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  return isVapidPublicKey(key) ? key : null;
}

/** The project's `push` Edge Function, or PUSH_FUNCTION_URL (the E2E tests' mock). */
export function getPushFunctionUrl(): string {
  return process.env.PUSH_FUNCTION_URL || `${getSupabasePublicEnv().url}/functions/v1/push`;
}
