import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  errorName,
  runDailyReminders,
  sendTestPush,
  type PushSender,
  type SafeLogger,
} from "./reminders.ts";
import { createReminderStore, findOwnSubscription, StoreError } from "./store.ts";
import { sendWebPush, type VapidKeys } from "./web-push.ts";

/** The function's settings: Supabase's own (injected by the runtime) and the VAPID secrets. */
export type PushEnv = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  /** null when a VAPID secret is missing: nothing can be sent. */
  vapid: VapidKeys | null;
};

export type HandlerDeps = {
  env: PushEnv;
  now?: () => Date;
  /** The push services' fetch (tests replace it); Supabase calls use the global fetch. */
  pushFetch?: typeof fetch;
  log?: SafeLogger;
};

export const SECRET_HEADER = "x-reminders-secret";
const MAX_BODY_BYTES = 4096;
const MAX_ENDPOINT_LENGTH = 2048;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Reads `{"kind": ..., ...}`; null for anything else (too large, not JSON, not an object). */
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** VAPID secrets from the environment, or null when one is missing. */
export function vapidFromEnv(read: (name: string) => string | undefined): VapidKeys | null {
  const publicKey = read("VAPID_PUBLIC_KEY");
  const privateKey = read("VAPID_PRIVATE_KEY");
  const subject = read("VAPID_SUBJECT");
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

const CLIENT_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } };

function pushSender(vapid: VapidKeys, now: () => Date, fetchImpl?: typeof fetch): PushSender {
  return (target, payload, ttlSeconds) =>
    sendWebPush(target, JSON.stringify(payload), vapid, {
      ttlSeconds,
      urgency: "high",
      topic: payload.tag,
      now: now(),
      fetchImpl,
    });
}

/**
 * The `push` Edge Function (NOTIF-14, 16). POST only, JSON body:
 * - `{"kind":"daily"}` from pg_cron with the Vault secret in `x-reminders-secret`;
 * - `{"kind":"test","endpoint":...}` with the signed-in user's JWT (Authorization: Bearer).
 * Answers carry status words only, never data. JWT verification at the gateway is off for
 * this function (supabase/config.toml): both kinds are authenticated here.
 */
export async function handlePushRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const now = deps.now ?? (() => new Date());
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }
  const body = await readBody(request);
  if (!body) {
    return json(400, { error: "bad_request" });
  }
  const { env } = deps;
  const service = createClient(env.supabaseUrl, env.serviceRoleKey, CLIENT_OPTIONS);
  try {
    if (body.kind === "daily") {
      return await handleDaily(request, service, deps, now, log);
    }
    if (body.kind === "test") {
      return await handleTest(request, body, service, deps, now, log);
    }
    return json(400, { error: "bad_request" });
  } catch (error) {
    // StoreError messages hold a database error code only; other errors by class name.
    log(`push: run failed (${error instanceof StoreError ? error.message : errorName(error)})`);
    return json(500, { error: "failed" });
  }
}

async function handleDaily(
  request: Request,
  service: SupabaseClient,
  deps: HandlerDeps,
  now: () => Date,
  log: SafeLogger,
): Promise<Response> {
  const secret = request.headers.get(SECRET_HEADER);
  if (!secret) {
    return json(401, { error: "unauthorized" });
  }
  const { data: valid, error } = await service.rpc("verify_reminders_secret", { p_secret: secret });
  if (error) {
    log(`push: verify_reminders_secret failed (code ${error.code ?? "none"})`);
    return json(500, { error: "failed" });
  }
  if (valid !== true) {
    return json(401, { error: "unauthorized" });
  }
  const vapid = deps.env.vapid;
  if (!vapid) {
    log("push: VAPID secrets are not set (docs/setup/push.md)");
    return json(500, { error: "not_configured" });
  }
  const result = await runDailyReminders({
    store: createReminderStore(service),
    send: pushSender(vapid, now, deps.pushFetch),
    now: now(),
    log,
  });
  return json(200, result);
}

async function handleTest(
  request: Request,
  body: Record<string, unknown>,
  service: SupabaseClient,
  deps: HandlerDeps,
  now: () => Date,
  log: SafeLogger,
): Promise<Response> {
  const token = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  const endpoint = body.endpoint;
  if (!token) {
    return json(401, { error: "unauthorized" });
  }
  if (
    typeof endpoint !== "string" ||
    endpoint.length === 0 ||
    endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    return json(400, { error: "bad_request" });
  }
  const { env } = deps;
  const user = createClient(env.supabaseUrl, env.anonKey, {
    ...CLIENT_OPTIONS,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: auth, error: authError } = await user.auth.getUser(token);
  if (authError || !auth.user) {
    return json(401, { error: "unauthorized" });
  }
  if (!env.vapid) {
    log("push: VAPID secrets are not set (docs/setup/push.md)");
    return json(500, { error: "not_configured" });
  }
  const subscription = await findOwnSubscription(user, endpoint);
  const result = await sendTestPush({
    subscription,
    send: pushSender(env.vapid, now, deps.pushFetch),
    deleteSubscription: async (id) => {
      const { error } = await user.from("push_subscriptions").delete().eq("id", id);
      if (error) {
        log(`push: delete gone subscription failed (code ${error.code ?? "none"})`);
      }
    },
    markDelivered: (id) => createReminderStore(service).markDelivered([id]),
    log,
  });
  return json(200, { status: result });
}
