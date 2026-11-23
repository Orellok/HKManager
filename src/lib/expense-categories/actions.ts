"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { EXPENSES_PATH } from "@/lib/expenses/paths";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { MOVE_DIRECTIONS } from "@/lib/milestones/reorder";
import { withNotice } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { SETTINGS_PATH, type SettingsNotice } from "./paths";
import {
  MAX_EXPENSE_CATEGORIES,
  createExpenseCategory,
  moveExpenseCategory,
  renameExpenseCategory,
  setExpenseCategoryArchived,
  type MoveCategoryResult,
  type SaveCategoryResult,
} from "./queries";
import {
  CATEGORY_FIELD_MESSAGES,
  categoryIdSchema,
  readCategoryFormValues,
  validateCategoryInput,
  type CategoryField,
  type CategoryFormValues,
} from "./schema";

/**
 * Server Actions for expense categories (EXP-3; owner decision M3: both allowlisted users
 * add, rename, reorder, archive and restore). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server.
 */

export type CategoryFormState = ServerFormState<CategoryField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. הקטגוריה לא נשמרה, אפשר לנסות שוב.",
  notFound: "הקטגוריה לא נמצאה.",
  tooMany: `אפשר להגדיר עד ${MAX_EXPENSE_CATEGORIES} קטגוריות. אפשר לשנות שם של קטגוריה קיימת.`,
  actionFailed: "הפעולה נכשלה. אפשר לנסות שוב.",
  archived: "הקטגוריה הועברה לארכיון. היא לא תוצע בהוצאות חדשות.",
  restored: "הקטגוריה הוחזרה מהארכיון.",
} as const;

/** Category names appear in the settings, the expense forms and the expenses list. */
function revalidateCategoryScreens() {
  revalidatePath(SETTINGS_PATH, "layout");
  revalidatePath(EXPENSES_PATH, "layout");
}

function savedState(
  values: CategoryFormValues,
  result: SaveCategoryResult,
): CategoryFormState | null {
  switch (result.status) {
    case "saved":
      return null;
    case "not_found":
      return { values, fieldErrors: {}, formError: MESSAGES.notFound };
    case "refused":
      return result.refusal === "name_taken"
        ? { values, fieldErrors: { name: CATEGORY_FIELD_MESSAGES.nameTaken }, formError: null }
        : { values, fieldErrors: {}, formError: MESSAGES.tooMany };
  }
}

async function saveCategoryForm(
  categoryId: string | null,
  formData: FormData,
): Promise<CategoryFormState> {
  const values = readCategoryFormValues(formData);
  const validation = validateCategoryInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }
  let result: SaveCategoryResult;
  try {
    const supabase = await createSupabaseServerClient();
    result =
      categoryId === null
        ? await createExpenseCategory(supabase, validation.data)
        : await renameExpenseCategory(supabase, categoryId, validation.data);
  } catch (error) {
    logDbFailure("expense_categories", categoryId === null ? "create" : "rename", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  const refused = savedState(values, result);
  if (refused) {
    return refused;
  }
  revalidateCategoryScreens();
  const notice: SettingsNotice = categoryId === null ? "category_created" : "category_renamed";
  redirect(withNotice(SETTINGS_PATH, notice));
}

/** EXP-3: adds a category at the end of the list. */
export async function createCategoryAction(
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireAllowedUser();
  return saveCategoryForm(null, formData);
}

/** EXP-3: renames a category. */
export async function renameCategoryAction(
  categoryId: string,
  _previous: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  await requireAllowedUser();
  const id = categoryIdSchema.safeParse(categoryId);
  if (!id.success) {
    return {
      values: readCategoryFormValues(formData),
      fieldErrors: {},
      formError: MESSAGES.notFound,
    };
  }
  return saveCategoryForm(id.data, formData);
}

export type MoveCategoryActionResult = MoveCategoryResult | { status: "failed"; error: string };

const moveInputSchema = z.object({ id: categoryIdSchema, direction: z.enum(MOVE_DIRECTIONS) });

/** EXP-3: moves an active category one place up or down among the active categories. */
export async function moveCategoryAction(
  categoryId: string,
  direction: string,
): Promise<MoveCategoryActionResult> {
  await requireAllowedUser();
  const parsed = moveInputSchema.safeParse({ id: categoryId, direction });
  if (!parsed.success) {
    return { status: "not_found" };
  }
  let result: MoveCategoryResult;
  try {
    result = await moveExpenseCategory(
      await createSupabaseServerClient(),
      parsed.data.id,
      parsed.data.direction,
    );
  } catch (error) {
    logDbFailure("expense_categories", "move", error);
    return { status: "failed", error: MESSAGES.actionFailed };
  }
  // Also after "edge" or "not_found": the screen was out of date, so it is reloaded.
  revalidateCategoryScreens();
  return result;
}

async function setArchived(categoryId: string, archived: boolean): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = categoryIdSchema.safeParse(categoryId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof setExpenseCategoryArchived>>;
  try {
    result = await setExpenseCategoryArchived(
      await createSupabaseServerClient(),
      id.data,
      archived,
    );
  } catch (error) {
    logDbFailure("expense_categories", archived ? "archive" : "restore", error);
    return { message: null, error: MESSAGES.actionFailed };
  }
  if (result === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateCategoryScreens();
  return { message: archived ? MESSAGES.archived : MESSAGES.restored, error: null };
}

/** Owner decision (M3): archives a category; its expenses keep it. */
export async function archiveCategoryAction(categoryId: string): Promise<ActionStatus> {
  return setArchived(categoryId, true);
}

/** Owner decision (M3): restores an archived category. */
export async function restoreCategoryAction(categoryId: string): Promise<ActionStatus> {
  return setArchived(categoryId, false);
}
