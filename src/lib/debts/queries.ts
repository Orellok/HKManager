import type { SupabaseClient } from "@supabase/supabase-js";

import { daysBetween } from "@/lib/dates";
import { agorotFromDb, agorotTotalFromDb } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";

/**
 * MS-6: open debts, read through bounded, parameterized database functions that filter and
 * sort in the database. "today" (Asia/Jerusalem) is passed in by the caller, from
 * todayInJerusalem() on the server.
 */

/** Rows per page of the open debts list. */
export const DEBTS_PAGE_SIZE = 50;

export type OpenDebt = {
  id: string;
  description: string;
  /** ISO date. */
  due_date: string;
  /** Whole days since the due date (at least 1). */
  days_overdue: number;
  /** Agorot left to pay. */
  balance: number;
  project_id: string;
  project_name: string;
  project_archived: boolean;
  client_id: string;
  client_name: string;
};

export type OpenDebtsPage = ListPage<OpenDebt>;

export type OpenDebtsSummary = { count: number; total: number };

type OpenDebtRow = Omit<OpenDebt, "balance" | "days_overdue"> & { balance: unknown };

/** One page of open debts, oldest due date first. */
export async function listOpenDebts(
  supabase: SupabaseClient,
  today: string,
  offset: number,
): Promise<OpenDebtsPage> {
  const { data, error } = await supabase.rpc("list_open_debts", {
    p_today: today,
    // One extra row tells whether another page exists.
    p_limit: DEBTS_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list open debts", { cause: error });
  }
  const rows = (data ?? []) as OpenDebtRow[];
  return {
    items: rows.slice(0, DEBTS_PAGE_SIZE).map((row) => ({
      ...row,
      balance: agorotFromDb(row.balance) ?? 0,
      days_overdue: daysBetween(row.due_date, today),
    })),
    hasMore: rows.length > DEBTS_PAGE_SIZE,
  };
}

/** The number of open debts and their total balance in agorot. */
export async function getOpenDebtsSummary(
  supabase: SupabaseClient,
  today: string,
): Promise<OpenDebtsSummary> {
  const { data, error } = await supabase
    .rpc("open_debts_summary", { p_today: today })
    .single<{ debt_count: unknown; total_balance: unknown }>();
  if (error) {
    throw new Error("Could not summarize open debts", { cause: error });
  }
  return {
    count: agorotTotalFromDb(data.debt_count),
    total: agorotTotalFromDb(data.total_balance),
  };
}
