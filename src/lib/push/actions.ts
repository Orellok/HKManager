"use server";

import { headers } from "next/headers";

import { requireAllowedUser } from "@/lib/auth/guards";
import { logDbFailure } from "@/lib/log";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { getPushFunctionUrl } from "./config";
import { boundedUserAgent, pushEndpointSchema, pushSubscriptionSchema } from "./schema";

/**
 * Server Actions of the settings screen's push section (NOTIF-5, 14; M7.2-7, 9). Each checks
 * the session with requireAllowedUser() first and validates what the browser sent.
 */

/** Raised by save_push_subscription() when 50 subscriptions exist. */
const SUBSCRIPTION_LIMIT_SQLSTATE = "HKP01";
const FUNCTION_TIMEOUT_MS = 15_000;

export type SavePushResult = { status: "saved" | "invalid" | "limit" | "failed" };

/** NOTIF-5: saves this browser's subscription for the signed-in user. */
export async function savePushSubscriptionAction(input: unknown): Promise<SavePushResult> {
  await requireAllowedUser();
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: boundedUserAgent((await headers()).get("user-agent")),
  });
  if (error) {
    if (error.code === SUBSCRIPTION_LIMIT_SQLSTATE) {
      return { status: "limit" };
    }
    logDbFailure("push_subscriptions", "save", new Error("save failed", { cause: error }));
    return { status: "failed" };
  }
  return { status: "saved" };
}

export type DeletePushResult = { status: "deleted" | "failed" };

/** NOTIF-5: forgets this browser's subscription (own rows only, RLS). */
export async function deletePushSubscriptionAction(endpoint: unknown): Promise<DeletePushResult> {
  await requireAllowedUser();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    // Nothing the database could hold: there is nothing to delete.
    return { status: "deleted" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", parsed.data);
  if (error) {
    logDbFailure("push_subscriptions", "delete", new Error("delete failed", { cause: error }));
    return { status: "failed" };
  }
  return { status: "deleted" };
}

export type TestPushResult = {
  status: "sent" | "not_found" | "gone" | "not_configured" | "failed";
};

const TEST_STATUSES: readonly TestPushResult["status"][] = ["sent", "not_found", "gone"];

/**
 * NOTIF-14: asks the push Edge Function to send a test message to this browser. The function
 * gets the user's own access token and sends only to that user's subscription (RLS).
 */
export async function sendTestPushAction(endpoint: unknown): Promise<TestPushResult> {
  await requireAllowedUser();
  const parsed = pushEndpointSchema.safeParse(endpoint);
  if (!parsed.success) {
    return { status: "not_found" };
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { status: "failed" };
  }
  try {
    const response = await fetch(getPushFunctionUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: getSupabasePublicEnv().anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind: "test", endpoint: parsed.data }),
      cache: "no-store",
      signal: AbortSignal.timeout(FUNCTION_TIMEOUT_MS),
    });
    const answer: unknown = await response.json().catch(() => null);
    const field = (name: string) =>
      typeof answer === "object" && answer !== null && name in answer
        ? (answer as Record<string, unknown>)[name]
        : undefined;
    if (response.ok) {
      const status = field("status");
      if (TEST_STATUSES.includes(status as TestPushResult["status"])) {
        return { status: status as TestPushResult["status"] };
      }
    } else if (field("error") === "not_configured") {
      return { status: "not_configured" };
    }
    console.error(`push: test push answered ${response.status}`);
    return { status: "failed" };
  } catch (error) {
    console.error(
      `push: test push request failed (${error instanceof Error ? error.name : "unknown"})`,
    );
    return { status: "failed" };
  }
}
