"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import type { ServerFormState } from "@/lib/forms";
import { isMonth } from "@/lib/incomes/month";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { EXPENSE_FILE_MESSAGES, checkUploadFile, isExpenseFileType } from "./file";
import { EXPENSES_PATH, type ExpenseNotice } from "./paths";
import {
  getExpensesSummary,
  insertExpense,
  listExpenses,
  softDeleteExpense,
  updateExpense,
  type ExpenseListPage,
  type ExpenseRefusal,
  type ExpensesSummary,
  type SaveExpenseResult,
} from "./queries";
import {
  EXPENSE_FIELD_MESSAGES,
  EXPENSE_FILE_PATH_FIELD,
  VENDOR_MAX_LENGTH,
  expenseIdSchema,
  readExpenseFormValues,
  validateExpenseInput,
  type ExpenseField,
  type ExpenseFormValues,
} from "./schema";
import {
  checkUploadedExpenseFile,
  createExpenseUpload,
  isExpenseObjectPath,
  removeUnrecordedExpenseFile,
} from "./storage";

/**
 * Server Actions for expenses (EXP-1..7). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server,
 * including ids bound in the browser, which a caller can change.
 *
 * A file is uploaded by the browser straight to Storage (see storage.ts): the form first
 * asks prepareExpenseUploadAction for a signed upload URL, uploads (an image compressed
 * first), and then saves with the object's path in EXPENSE_FILE_PATH_FIELD. The save reads
 * the stored object back and checks it before the expense records it; an upload that is not
 * recorded is removed.
 */

export type ExpenseFormState = ServerFormState<ExpenseField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. ההוצאה לא נשמרה, אפשר לנסות שוב.",
  notFound: "ההוצאה לא נמצאה. ייתכן שנמחקה.",
  categoryMissing: "הקטגוריה לא נמצאה. יש לבחור קטגוריה אחרת.",
  fileMissing: "הקובץ לא הגיע לשמירה. יש לבחור את הקובץ שוב.",
  uploadUnavailable: "לא ניתן להעלות את הקובץ כרגע. אפשר לנסות שוב.",
  deleteFailed: "המחיקה נכשלה. אפשר לנסות שוב.",
} as const;

/** Expenses appear on the expenses list and their own edit page. */
function revalidateExpenseScreens() {
  revalidatePath(EXPENSES_PATH, "layout");
}

function refusedState(values: ExpenseFormValues, refusal: ExpenseRefusal): ExpenseFormState {
  switch (refusal) {
    case "date_in_future":
      return {
        values,
        fieldErrors: { expense_date: EXPENSE_FIELD_MESSAGES.dateInFuture },
        formError: null,
      };
    case "category_archived":
      return {
        values,
        fieldErrors: { category_id: EXPENSE_FIELD_MESSAGES.categoryArchived },
        formError: null,
      };
    case "category_missing":
      return { values, fieldErrors: { category_id: MESSAGES.categoryMissing }, formError: null };
    case "file_missing":
      return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
  }
}

export type PrepareExpenseUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; fieldError?: string; formError?: string };

const fileInfoSchema = z.object({
  size: z.number().int().min(0),
  type: z.string().max(200),
});

/**
 * EXP-2: a signed upload URL for a new expense file, after checking the declared size and
 * type of what the browser is about to upload (the stored object is checked again before it
 * is recorded).
 */
export async function prepareExpenseUploadAction(fileParam: {
  size: number;
  type: string;
}): Promise<PrepareExpenseUploadResult> {
  await requireAllowedUser();
  const file = fileInfoSchema.safeParse(fileParam);
  if (!file.success) {
    return { ok: false, fieldError: EXPENSE_FILE_MESSAGES.unsupported };
  }
  const problem = checkUploadFile(file.data);
  const type = file.data.type;
  if (problem || !isExpenseFileType(type)) {
    return { ok: false, fieldError: EXPENSE_FILE_MESSAGES[problem ?? "unsupported"] };
  }
  try {
    return { ok: true, ...(await createExpenseUpload(await createSupabaseServerClient(), type)) };
  } catch (error) {
    logDbFailure("expenses", "prepare upload", error);
    return { ok: false, formError: MESSAGES.uploadUnavailable };
  }
}

/**
 * Validates and saves (new when `expenseId` is null). A new upload is checked before the
 * expense records it; an edit without a new upload keeps the expense's current file.
 */
async function saveExpenseForm(
  expenseId: string | null,
  formData: FormData,
): Promise<ExpenseFormState> {
  const values = readExpenseFormValues(formData);
  const uploadedValue = formData.get(EXPENSE_FILE_PATH_FIELD);
  const uploadedPath =
    typeof uploadedValue === "string" && uploadedValue !== "" ? uploadedValue : null;
  const supabase = await createSupabaseServerClient();
  // Whatever happens next, an upload that does not end up recorded is removed.
  let recorded = false;
  let hasFile = false;
  try {
    const validation = validateExpenseInput(values, todayInJerusalem());
    if (!validation.success) {
      return { values, fieldErrors: validation.fieldErrors, formError: null };
    }
    if (uploadedPath !== null) {
      if (!isExpenseObjectPath(uploadedPath)) {
        return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
      }
      const check = await checkUploadedExpenseFile(supabase, uploadedPath);
      if (check.status === "missing") {
        return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
      }
      if (check.status === "invalid") {
        return {
          values,
          fieldErrors: { file: EXPENSE_FILE_MESSAGES[check.error] },
          formError: null,
        };
      }
    }

    let result: SaveExpenseResult;
    try {
      result =
        expenseId === null
          ? await insertExpense(supabase, validation.data, uploadedPath)
          : await updateExpense(supabase, expenseId, validation.data, uploadedPath);
    } catch (error) {
      logDbFailure("expenses", expenseId === null ? "create" : "update", error);
      return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
    }
    if (result.status === "not_found") {
      return { values, fieldErrors: {}, formError: MESSAGES.notFound };
    }
    if (result.status === "refused") {
      return refusedState(values, result.refusal);
    }
    recorded = true;
    hasFile = result.hasFile;
  } catch (error) {
    logDbFailure("expenses", "check upload", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  } finally {
    if (uploadedPath !== null && !recorded) {
      await removeUnrecordedExpenseFile(supabase, uploadedPath);
    }
  }
  revalidateExpenseScreens();
  const notice: ExpenseNotice =
    expenseId === null
      ? hasFile
        ? "created_with_file"
        : "created"
      : hasFile
        ? "updated_with_file"
        : "updated";
  redirect(withNotice(EXPENSES_PATH, notice));
}

/** EXP-1 / EXP-2: records an expense, with or without a file, and returns to the list. */
export async function createExpenseAction(
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireAllowedUser();
  return saveExpenseForm(null, formData);
}

/** EXP-1: saves changes to an expense (attaching or replacing its file). */
export async function updateExpenseAction(
  expenseId: string,
  _previous: ExpenseFormState,
  formData: FormData,
): Promise<ExpenseFormState> {
  await requireAllowedUser();
  const id = expenseIdSchema.safeParse(expenseId);
  if (!id.success) {
    return {
      values: readExpenseFormValues(formData),
      fieldErrors: {},
      formError: MESSAGES.notFound,
    };
  }
  return saveExpenseForm(id.data, formData);
}

/**
 * SPEC 6 / owner decision (M3): soft-deletes an expense (after the confirmation dialog) and
 * returns to the list. Returns only on failure.
 */
export async function deleteExpenseAction(expenseId: string): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = expenseIdSchema.safeParse(expenseId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof softDeleteExpense>>;
  try {
    result = await softDeleteExpense(await createSupabaseServerClient(), id.data);
  } catch (error) {
    logDbFailure("expenses", "delete", error);
    return { message: null, error: MESSAGES.deleteFailed };
  }
  if (result === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateExpenseScreens();
  redirect(withNotice(EXPENSES_PATH, "deleted" satisfies ExpenseNotice));
}

export type SearchExpensesResult =
  | {
      ok: true;
      page: ExpenseListPage;
      /** The filter's count and total; only with the first page (offset 0). */
      summary: ExpensesSummary | null;
    }
  | { ok: false };

const searchInputSchema = z.object({
  month: z.string().refine(isMonth),
  categoryId: z.union([z.literal(""), z.uuid()]),
  vendor: z.string().trim().max(VENDOR_MAX_LENGTH),
  missingDocument: z.boolean(),
  offset: z.number().int().min(0),
});

/**
 * EXP-4 / EXP-6: a page of the expenses list for the filters, through a Server Action (POST,
 * so the vendor searched never appears in a URL), with the filter's total on the first page.
 */
export async function searchExpensesAction(input: {
  month: string;
  categoryId: string;
  vendor: string;
  missingDocument: boolean;
  offset: number;
}): Promise<SearchExpensesResult> {
  await requireAllowedUser();
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  const filter = {
    month: parsed.data.month,
    categoryId: parsed.data.categoryId || null,
    vendor: parsed.data.vendor,
    missingDocument: parsed.data.missingDocument,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const [page, summary] = await Promise.all([
      listExpenses(supabase, filter, parsed.data.offset),
      parsed.data.offset === 0 ? getExpensesSummary(supabase, filter) : null,
    ]);
    return { ok: true, page, summary };
  } catch (error) {
    logDbFailure("expenses", "list", error);
    return { ok: false };
  }
}
