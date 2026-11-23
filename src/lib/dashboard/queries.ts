import type { SupabaseClient } from "@supabase/supabase-js";

import type { CeilingInput, TurnoverBasis } from "@/lib/ceiling/status";
import { countFromDb } from "@/lib/db-numbers";
import { isMonth } from "@/lib/incomes/month";
import { agorotTotalFromDb } from "@/lib/money";
import { z } from "@/lib/zod";

import { periodStart, type DashboardPeriod } from "./period";

/**
 * DASH-1..5 / CEIL-2..6: every number the dashboard shows comes from one database function,
 * dashboard_data(), in one round trip; the sums are computed in the database (SPEC 8). The
 * call runs with the caller's session, so RLS applies; callers check access first.
 */

export type MonthTotals = {
  /** "YYYY-MM". */
  month: string;
  /** Agorot. */
  income: number;
  expense: number;
};

export type CategoryTotal = { id: string; name: string; total: number; count: number };

export type DashboardData = {
  period: { income: number; expense: number; previousIncome: number; previousExpense: number };
  /** DASH-3: 12 months, oldest first. */
  series: MonthTotals[];
  /** DASH-4: the period's expenses per category, largest first. */
  categories: CategoryTotal[];
  cards: {
    openDebtsCount: number;
    openDebtsTotal: number;
    pendingReceipts: number;
    receiptsIssuedThisMonth: number;
    /** Expenses without a document in the current month. */
    missingDocuments: number;
  };
  ceiling: CeilingInput & { basis: TurnoverBasis };
  isAdmin: boolean;
};

const SERIES_MONTHS = 12;

/** Agorot sums and counts: non-negative safe integers (precision lost in JSON is rejected). */
const total = z.unknown().transform((value) => agorotTotalFromDb(value));
const count = z.unknown().transform((value) => countFromDb(value));

const dashboardSchema = z.object({
  period: z.object({
    income: total,
    expense: total,
    previous_income: total,
    previous_expense: total,
  }),
  series: z
    .array(z.object({ month: z.string().refine(isMonth), income: total, expense: total }))
    .length(SERIES_MONTHS),
  categories: z.array(z.object({ id: z.string(), name: z.string(), total, count })),
  cards: z.object({
    open_debts_count: count,
    open_debts_total: total,
    pending_receipts: count,
    receipts_issued_this_month: count,
    missing_documents: count,
  }),
  ceiling: z.object({
    year: z.number().int(),
    ceiling: z.union([z.null(), total]),
    turnover: total,
    basis: z.enum(["received_date", "receipt_date"]),
    acked: z.array(z.number().int()),
    is_admin: z.boolean(),
  }),
});

/** The function's JSON as the app uses it; anything unexpected is rejected, not shown wrong. */
export function parseDashboardData(json: unknown): DashboardData {
  const data = dashboardSchema.parse(json);
  return {
    period: {
      income: data.period.income,
      expense: data.period.expense,
      previousIncome: data.period.previous_income,
      previousExpense: data.period.previous_expense,
    },
    series: data.series,
    categories: data.categories,
    cards: {
      openDebtsCount: data.cards.open_debts_count,
      openDebtsTotal: data.cards.open_debts_total,
      pendingReceipts: data.cards.pending_receipts,
      receiptsIssuedThisMonth: data.cards.receipts_issued_this_month,
      missingDocuments: data.cards.missing_documents,
    },
    ceiling: {
      year: data.ceiling.year,
      ceiling: data.ceiling.ceiling,
      turnover: data.ceiling.turnover,
      acked: data.ceiling.acked,
      basis: data.ceiling.basis,
    },
    isAdmin: data.ceiling.is_admin,
  };
}

/** The dashboard of a period; `today` is todayInJerusalem() (open debts, current month). */
export async function getDashboardData(
  supabase: SupabaseClient,
  period: DashboardPeriod,
  today: string,
): Promise<DashboardData> {
  const { data, error } = await supabase.rpc("dashboard_data", {
    p_period: period.kind,
    p_period_start: periodStart(period),
    p_today: today,
  });
  if (error) {
    throw new Error("Could not load the dashboard", { cause: error });
  }
  return parseDashboardData(data);
}
