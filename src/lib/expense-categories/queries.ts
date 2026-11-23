import type { SupabaseClient } from "@supabase/supabase-js";

import { countFromDb } from "@/lib/db-numbers";
import type { MoveDirection } from "@/lib/milestones/reorder";

import type { CategoryInput } from "./schema";

/**
 * Data access for expense categories (EXP-3). Every call runs with the caller's session, so
 * RLS applies; callers check access with requireAllowedUser() first.
 */

const TABLE = "expense_categories";

/**
 * The database holds at most this many categories (HKC01), so every screen reads the whole
 * list in one request, far below PostgREST's row limit.
 */
export const MAX_EXPENSE_CATEGORIES = 100;

/** Postgres unique_violation: another category has the name. */
const UNIQUE_VIOLATION = "23505";
/** Raised by expense_categories_assign_sort_order(). */
const TOO_MANY = "HKC01";

export type ExpenseCategory = {
  id: string;
  name: string;
  archived: boolean;
};

type CategoryRow = { id: string; name: string; archived_at: string | null };

function toCategory(row: CategoryRow): ExpenseCategory {
  return { id: row.id, name: row.name, archived: row.archived_at !== null };
}

/** Every category, in the managed order (active and archived alike). */
export async function listExpenseCategories(supabase: SupabaseClient): Promise<ExpenseCategory[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, archived_at")
    .order("sort_order")
    .limit(MAX_EXPENSE_CATEGORIES);
  if (error) {
    throw new Error("Could not list the expense categories", { cause: error });
  }
  return (data as CategoryRow[]).map(toCategory);
}

/** One category, or null when it does not exist (or is not visible). */
export async function getExpenseCategory(
  supabase: SupabaseClient,
  id: string,
): Promise<ExpenseCategory | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, name, archived_at")
    .eq("id", id)
    .maybeSingle<CategoryRow>();
  if (error) {
    throw new Error("Could not read the expense category", { cause: error });
  }
  return data ? toCategory(data) : null;
}

export type SaveCategoryResult =
  | { status: "saved" }
  | { status: "not_found" }
  | { status: "refused"; refusal: "name_taken" | "too_many" };

function refusalOf(code: string | undefined): "name_taken" | "too_many" | null {
  if (code === UNIQUE_VIOLATION) {
    return "name_taken";
  }
  return code === TOO_MANY ? "too_many" : null;
}

/** EXP-3: adds a category at the end of the list. */
export async function createExpenseCategory(
  supabase: SupabaseClient,
  input: CategoryInput,
): Promise<SaveCategoryResult> {
  const { error } = await supabase.from(TABLE).insert({ name: input.name });
  if (error) {
    const refusal = refusalOf(error.code);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not add the expense category", { cause: error });
  }
  return { status: "saved" };
}

/** EXP-3: renames a category (active or archived). */
export async function renameExpenseCategory(
  supabase: SupabaseClient,
  id: string,
  input: CategoryInput,
): Promise<SaveCategoryResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ name: input.name })
    .eq("id", id)
    .select("id");
  if (error) {
    const refusal = refusalOf(error.code);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not rename the expense category", { cause: error });
  }
  return data.length > 0 ? { status: "saved" } : { status: "not_found" };
}

/**
 * Owner decision (M3): archives a category (hidden when choosing for a new expense, still
 * shown on existing ones) or restores it. The database stamps the time.
 */
export async function setExpenseCategoryArchived(
  supabase: SupabaseClient,
  id: string,
  archived: boolean,
): Promise<"updated" | "not_found"> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) {
    throw new Error("Could not change the expense category's archive state", { cause: error });
  }
  return data.length > 0 ? "updated" : "not_found";
}

export type MoveCategoryResult =
  | {
      /** "edge": already first (up) or last (down) among the active categories. */
      status: "moved" | "edge";
      /** The category's place among the active categories after the call, 1-based. */
      place: number;
      /** The number of active categories. */
      total: number;
    }
  | { status: "not_found" };

type MoveRow = { result: unknown; place: unknown; total: unknown };

/** EXP-3: swaps an active category with its active neighbour, under the order lock. */
export async function moveExpenseCategory(
  supabase: SupabaseClient,
  id: string,
  direction: MoveDirection,
): Promise<MoveCategoryResult> {
  const { data, error } = await supabase
    .rpc("move_expense_category", { p_category_id: id, p_direction: direction })
    .single<MoveRow>();
  if (error) {
    throw new Error("Could not move the expense category", { cause: error });
  }
  if (data.result === "not_found") {
    return { status: "not_found" };
  }
  if (data.result !== "moved" && data.result !== "edge") {
    throw new Error("move_expense_category returned an unexpected result");
  }
  const place = countFromDb(data.place);
  const total = countFromDb(data.total);
  if (place < 1 || place > total) {
    throw new Error("move_expense_category returned a place outside the list");
  }
  return { status: data.result, place, total };
}
