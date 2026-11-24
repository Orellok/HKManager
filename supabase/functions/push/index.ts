// Supabase Edge Function `push` (M7.2, NOTIF-14 and NOTIF-16): the daily reminder from
// pg_cron and the test push from the settings screen. All logic is in ../_shared (tested in
// Node); this file only reads the runtime's environment. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase; the VAPID_* secrets are set by the owner
// (docs/setup/push.md).
import { handlePushRequest, vapidFromEnv } from "../_shared/handler.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const env = {
  supabaseUrl: required("SUPABASE_URL"),
  anonKey: required("SUPABASE_ANON_KEY"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  vapid: vapidFromEnv((name) => Deno.env.get(name)),
};

Deno.serve((request) => handlePushRequest(request, { env }));
