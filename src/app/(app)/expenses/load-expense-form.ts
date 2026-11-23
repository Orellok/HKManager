import { listExpenseCategories, type ExpenseCategory } from "@/lib/expense-categories/queries";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadRecordOrNotFound } from "../load-or-not-found";

export type CategoryOption = { value: string; label: string };

/** How an archived category is named wherever it is still shown (owner decision M3). */
export function categoryLabel(category: Pick<ExpenseCategory, "name" | "archived">): string {
  return category.archived ? `${category.name} (בארכיון)` : category.name;
}

/**
 * The categories the expense form offers, in the managed order: the active ones, plus the
 * expense's own category when it is archived (owner decision M3: archived categories are
 * hidden for new expenses but still shown on existing ones). Call after requireAllowedUser().
 */
export async function loadCategoryOptions(
  currentCategoryId: string | null = null,
): Promise<CategoryOption[]> {
  let categories: ExpenseCategory[];
  try {
    categories = await listExpenseCategories(await createSupabaseServerClient());
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("expense_categories", "read form choices", error);
    throw new Error("Could not load the categories for the expense form");
  }
  return categories
    .filter((category) => !category.archived || category.id === currentCategoryId)
    .map((category) => ({ value: category.id, label: categoryLabel(category) }));
}

/** Reads one record for a form page; a failure goes to the error boundary, none is a 404. */
export async function loadOrNotFound<Row>(
  operation: string,
  read: () => Promise<Row | null>,
): Promise<Row> {
  return loadRecordOrNotFound("expenses", operation, read);
}
