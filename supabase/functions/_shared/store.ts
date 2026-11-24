import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaimedRun, ReminderGroup, ReminderStore, StoredSubscription } from "./reminders.ts";

const REMINDER_GROUPS: readonly string[] = ["today", "tomorrow", "overdue"];
const SUBSCRIPTION_COLUMNS = "id, endpoint, p256dh, auth";

/** A database error by its code only: messages and details can carry row values. */
export class StoreError extends Error {
  constructor(operation: string, code: string | undefined) {
    super(`push store: ${operation} failed (code ${code ?? "none"})`);
    this.name = "StoreError";
  }
}

function check(operation: string, error: { code?: string } | null): void {
  if (error) {
    throw new StoreError(operation, error.code);
  }
}

type ClaimRow = {
  claimed: boolean;
  count_overdue: number;
  count_today: number;
  count_tomorrow: number;
  single_title: string | null;
  single_group: string | null;
};

/** The daily run's database calls, with the service role client (supabase/migrations M7.2). */
export function createReminderStore(service: SupabaseClient): ReminderStore {
  return {
    async claimRun(runDate: string): Promise<ClaimedRun> {
      const { data, error } = await service.rpc("claim_reminder_run", { p_run_date: runDate });
      check("claim_reminder_run", error);
      const row = (data as ClaimRow[] | null)?.[0];
      if (!row) {
        throw new StoreError("claim_reminder_run", "no_row");
      }
      const single =
        row.single_title !== null &&
        row.single_group !== null &&
        REMINDER_GROUPS.includes(row.single_group)
          ? { title: row.single_title, group: row.single_group as ReminderGroup }
          : null;
      return {
        claimed: row.claimed,
        counts: {
          overdue: row.count_overdue,
          today: row.count_today,
          tomorrow: row.count_tomorrow,
        },
        single,
      };
    },
    async listSubscriptions(limit: number): Promise<StoredSubscription[]> {
      const { data, error } = await service
        .from("push_subscriptions")
        .select(SUBSCRIPTION_COLUMNS)
        .order("created_at")
        .limit(limit);
      check("list push_subscriptions", error);
      return (data ?? []) as StoredSubscription[];
    },
    async markDelivered(ids: string[]): Promise<void> {
      if (ids.length === 0) {
        return;
      }
      const { error } = await service
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString() })
        .in("id", ids);
      check("mark push_subscriptions delivered", error);
    },
    async deleteSubscriptions(ids: string[]): Promise<void> {
      if (ids.length === 0) {
        return;
      }
      const { error } = await service.from("push_subscriptions").delete().in("id", ids);
      check("delete push_subscriptions", error);
    },
    async finishRun(runDate: string, sent: number, failed: number): Promise<void> {
      const { error } = await service.rpc("finish_reminder_run", {
        p_run_date: runDate,
        p_sent: sent,
        p_failed: failed,
      });
      check("finish_reminder_run", error);
    },
  };
}

/** NOTIF-14: the caller's own subscription for this endpoint, or null (RLS: own rows only). */
export async function findOwnSubscription(
  user: SupabaseClient,
  endpoint: string,
): Promise<StoredSubscription | null> {
  const { data, error } = await user
    .from("push_subscriptions")
    .select(SUBSCRIPTION_COLUMNS)
    .eq("endpoint", endpoint)
    .maybeSingle();
  check("find own push subscription", error);
  return (data as StoredSubscription | null) ?? null;
}
