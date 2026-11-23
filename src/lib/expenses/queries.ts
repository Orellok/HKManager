import type { SupabaseClient } from "@supabase/supabase-js";

import { countFromDb } from "@/lib/db-numbers";
import { monthStart } from "@/lib/incomes/month";
import { isPaymentMethod, type PaymentMethod } from "@/lib/incomes/payment-methods";
import { agorotFromDb, agorotTotalFromDb } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";

import type { ExpenseInput } from "./schema";

/**
 * Data access for expenses (EXP-1..7). Every call runs with the caller's session, so RLS
 * applies; the callers (pages and Server Actions) check access with requireAllowedUser()
 * first. Totals are computed in the database.
 */

const TABLE = "expenses";

/** Rows per page of the expenses list. */
export const EXPENSES_PAGE_SIZE = 50;

/** Postgres foreign_key_violation: the category no longer exists. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres unique_violation: the file is already another expense's. */
const UNIQUE_VIOLATION = "23505";
/** Raised by expenses_check_references(). */
const DATE_IN_FUTURE = "HKE01";
const CATEGORY_ARCHIVED = "HKE02";
const FILE_MISSING = "HKE03";

export type Expense = {
  id: string;
  /** ISO date. */
  expense_date: string;
  /** Agorot, more than 0. */
  amount: number;
  vendor: string;
  category_id: string;
  category_name: string;
  category_archived: boolean;
  payment_method: PaymentMethod;
  notes: string | null;
  file_path: string | null;
};

type ExpenseRow = Omit<
  Expense,
  "amount" | "payment_method" | "category_name" | "category_archived"
> & {
  amount: unknown;
  payment_method: unknown;
  expense_categories: { name: string; archived_at: string | null } | null;
};

function paymentMethodFromDb(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new RangeError("The database returned an unknown payment method");
  }
  return value;
}

/** One expense that is not deleted, or null when it does not exist (or is not visible). */
export async function getExpense(supabase: SupabaseClient, id: string): Promise<Expense | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(
      "id, expense_date, amount, vendor, category_id, payment_method, notes, file_path, expense_categories(name, archived_at)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<ExpenseRow>();
  if (error) {
    throw new Error("Could not read the expense", { cause: error });
  }
  if (!data) {
    return null;
  }
  const { expense_categories: category, ...row } = data;
  if (!category) {
    throw new RangeError("The database returned an expense without its category");
  }
  return {
    ...row,
    amount: agorotFromDb(row.amount) ?? 0,
    payment_method: paymentMethodFromDb(row.payment_method),
    category_name: category.name,
    category_archived: category.archived_at !== null,
  };
}

/** Why the database refused to save an expense. */
export type ExpenseRefusal =
  "date_in_future" | "category_archived" | "category_missing" | "file_missing";

const REFUSALS: Record<string, ExpenseRefusal> = {
  [DATE_IN_FUTURE]: "date_in_future",
  [CATEGORY_ARCHIVED]: "category_archived",
  [FOREIGN_KEY_VIOLATION]: "category_missing",
  [FILE_MISSING]: "file_missing",
  // The path is another expense's file: only a tampered form gets here.
  [UNIQUE_VIOLATION]: "file_missing",
};

export type SaveExpenseResult =
  /** hasFile: the saved expense has a file (EXP-7). */
  | { status: "saved"; hasFile: boolean }
  | { status: "not_found" }
  | { status: "refused"; refusal: ExpenseRefusal };

function refusedOrThrow(error: { code?: string }, message: string): SaveExpenseResult {
  const refusal = error.code ? REFUSALS[error.code] : undefined;
  if (refusal) {
    return { status: "refused", refusal };
  }
  throw new Error(message, { cause: error });
}

/** EXP-1: records a new expense, with the path of its checked file or without one. */
export async function insertExpense(
  supabase: SupabaseClient,
  input: ExpenseInput,
  filePath: string | null,
): Promise<SaveExpenseResult> {
  const { error } = await supabase.from(TABLE).insert({ ...input, file_path: filePath });
  return error
    ? refusedOrThrow(error, "Could not save the expense")
    : { status: "saved", hasFile: filePath !== null };
}

/**
 * EXP-1: saves changes to an expense that is not deleted. `newFilePath` attaches a checked
 * file (the one it replaces stays in storage, recorded); null keeps the current file.
 */
export async function updateExpense(
  supabase: SupabaseClient,
  id: string,
  input: ExpenseInput,
  newFilePath: string | null,
): Promise<SaveExpenseResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(newFilePath === null ? input : { ...input, file_path: newFilePath })
    .eq("id", id)
    .is("deleted_at", null)
    .select("file_path");
  if (error) {
    return refusedOrThrow(error, "Could not update the expense");
  }
  const row = (data as { file_path: string | null }[])[0];
  return row ? { status: "saved", hasFile: row.file_path !== null } : { status: "not_found" };
}

/** SPEC 6 / owner decision (M3): soft-deletes an expense (the audit trigger records it). */
export async function softDeleteExpense(
  supabase: SupabaseClient,
  id: string,
): Promise<"deleted" | "not_found"> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    throw new Error("Could not delete the expense", { cause: error });
  }
  return data.length > 0 ? "deleted" : "not_found";
}

export type ExpenseListItem = {
  id: string;
  /** ISO date. */
  expense_date: string;
  /** Agorot. */
  amount: number;
  vendor: string;
  payment_method: PaymentMethod;
  category_id: string;
  category_name: string;
  /** EXP-6: false = "חסר מסמך". */
  has_file: boolean;
};

export type ExpenseListPage = ListPage<ExpenseListItem>;

export type ExpenseListFilter = {
  /** "YYYY-MM". */
  month: string;
  /** Only this category's expenses, or null for all. */
  categoryId: string | null;
  /** Only expenses whose vendor contains this text (any case); "" for all. */
  vendor: string;
  /** EXP-6: only expenses without a file. */
  missingDocument: boolean;
};

type ExpenseListRow = Omit<ExpenseListItem, "amount" | "payment_method" | "has_file"> & {
  amount: unknown;
  payment_method: unknown;
  has_file: unknown;
};

function toListItem(row: ExpenseListRow): ExpenseListItem {
  if (typeof row.has_file !== "boolean") {
    throw new RangeError("The database returned no file state");
  }
  return {
    ...row,
    amount: agorotFromDb(row.amount) ?? 0,
    payment_method: paymentMethodFromDb(row.payment_method),
    has_file: row.has_file,
  };
}

function filterParams({ month, categoryId, vendor, missingDocument }: ExpenseListFilter) {
  return {
    p_month: monthStart(month),
    p_category_id: categoryId,
    p_vendor: vendor,
    p_missing_document: missingDocument,
  };
}

/** EXP-4: one page of the expenses the filter selects, newest expense date first. */
export async function listExpenses(
  supabase: SupabaseClient,
  filter: ExpenseListFilter,
  offset: number,
): Promise<ExpenseListPage> {
  const { data, error } = await supabase.rpc("list_expenses", {
    ...filterParams(filter),
    // One extra row tells whether another page exists.
    p_limit: EXPENSES_PAGE_SIZE + 1,
    p_offset: offset,
  });
  if (error) {
    throw new Error("Could not list expenses", { cause: error });
  }
  const rows = (data ?? []) as ExpenseListRow[];
  return {
    items: rows.slice(0, EXPENSES_PAGE_SIZE).map(toListItem),
    hasMore: rows.length > EXPENSES_PAGE_SIZE,
  };
}

export type ExpensesSummary = { count: number; total: number };

/** EXP-4: the number and total (agorot) of the expenses the filter selects. */
export async function getExpensesSummary(
  supabase: SupabaseClient,
  filter: ExpenseListFilter,
): Promise<ExpensesSummary> {
  const { data, error } = await supabase
    .rpc("expenses_summary", filterParams(filter))
    .single<{ expense_count: unknown; total: unknown }>();
  if (error) {
    throw new Error("Could not summarize expenses", { cause: error });
  }
  return { count: countFromDb(data.expense_count), total: agorotTotalFromDb(data.total) };
}
