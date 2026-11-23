import type { SupabaseClient } from "@supabase/supabase-js";

import { isIsoDate } from "@/lib/dates";
import { isPaymentMethod, type PaymentMethod } from "@/lib/incomes/payment-methods";
import { agorotFromDb } from "@/lib/money";

import type { ExportKind, ExportRange } from "./range";

/**
 * EXPORT-1 / EXPORT-3: reads an export's rows page by page through export_incomes() /
 * export_expenses(), with the caller's session (RLS applies; the Route Handler checks access
 * with requireAllowedUser() first). Pages follow a keyset cursor, so memory stays bounded by
 * one page whatever the range, and reading stops at the first empty page, so a server row
 * limit lower than EXPORT_PAGE_SIZE can shorten pages but never the file.
 */

/** Rows per request; the database functions and PostgREST (max_rows) cap it at 1000. */
export const EXPORT_PAGE_SIZE = 1000;

export type IncomeExportRow = {
  /** ISO date. */
  received_date: string;
  client_name: string;
  project_name: string | null;
  milestone_description: string | null;
  /** Agorot. */
  amount: number;
  payment_method: PaymentMethod;
  receipt_number: string | null;
  /** ISO date, or null without a receipt. */
  receipt_date: string | null;
};

export type ExpenseExportRow = {
  /** ISO date. */
  expense_date: string;
  vendor: string;
  category_name: string;
  /** Agorot. */
  amount: number;
  payment_method: PaymentMethod;
  has_file: boolean;
};

export type ExportRows = { incomes: IncomeExportRow; expenses: ExpenseExportRow };

type Cursor = { date: string; createdAt: string; id: string };

type RawRow = Record<string, unknown>;

const FUNCTIONS: Record<ExportKind, string> = {
  incomes: "export_incomes",
  expenses: "export_expenses",
};

const DATE_COLUMNS: Record<ExportKind, string> = {
  incomes: "received_date",
  expenses: "expense_date",
};

function text(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new RangeError(`The database returned no ${column}`);
  }
  return value;
}

function optionalText(value: unknown, column: string): string | null {
  return value === null ? null : text(value, column);
}

function isoDate(value: unknown, column: string): string {
  const date = text(value, column);
  if (!isIsoDate(date)) {
    throw new RangeError(`The database returned an invalid ${column}`);
  }
  return date;
}

function amount(value: unknown): number {
  const agorot = agorotFromDb(value);
  if (agorot === null) {
    throw new RangeError("The database returned no amount");
  }
  return agorot;
}

function paymentMethod(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new RangeError("The database returned an unknown payment method");
  }
  return value;
}

function toIncomeRow(row: RawRow): IncomeExportRow {
  return {
    received_date: isoDate(row.received_date, "received_date"),
    client_name: text(row.client_name, "client_name"),
    project_name: optionalText(row.project_name, "project_name"),
    milestone_description: optionalText(row.milestone_description, "milestone_description"),
    amount: amount(row.amount),
    payment_method: paymentMethod(row.payment_method),
    receipt_number: optionalText(row.receipt_number, "receipt_number"),
    receipt_date: row.receipt_date === null ? null : isoDate(row.receipt_date, "receipt_date"),
  };
}

function toExpenseRow(row: RawRow): ExpenseExportRow {
  if (typeof row.has_file !== "boolean") {
    throw new RangeError("The database returned no document status");
  }
  return {
    expense_date: isoDate(row.expense_date, "expense_date"),
    vendor: text(row.vendor, "vendor"),
    category_name: text(row.category_name, "category_name"),
    amount: amount(row.amount),
    payment_method: paymentMethod(row.payment_method),
    has_file: row.has_file,
  };
}

const CONVERTERS: { [Kind in ExportKind]: (row: RawRow) => ExportRows[Kind] } = {
  incomes: toIncomeRow,
  expenses: toExpenseRow,
};

/**
 * The export's rows in pages, oldest date first (then the order they were recorded). Each
 * page is read only when the previous one has been consumed.
 */
export async function* exportPages<Kind extends ExportKind>(
  supabase: SupabaseClient,
  kind: Kind,
  range: ExportRange,
): AsyncGenerator<ExportRows[Kind][], void, undefined> {
  const convert = CONVERTERS[kind] as (row: RawRow) => ExportRows[Kind];
  let cursor: Cursor | null = null;
  for (;;) {
    const { data, error } = await supabase.rpc(FUNCTIONS[kind], {
      p_from: range.from,
      p_to: range.to,
      p_after_date: cursor?.date ?? null,
      p_after_created_at: cursor?.createdAt ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: EXPORT_PAGE_SIZE,
    });
    if (error) {
      throw new Error(`Could not read the ${kind} export`, { cause: error });
    }
    const rows = (data ?? []) as RawRow[];
    if (rows.length === 0) {
      return;
    }
    const last = rows[rows.length - 1];
    cursor = {
      date: isoDate(last[DATE_COLUMNS[kind]], DATE_COLUMNS[kind]),
      createdAt: text(last.created_at, "created_at"),
      id: text(last.id, "id"),
    };
    yield rows.map(convert);
  }
}
