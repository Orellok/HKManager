"use server";

import { redirect } from "next/navigation";

import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import type { ServerFormState } from "@/lib/forms";
import type { IncomeListPage } from "@/lib/incomes/queries";
import { revalidateIncomeScreens } from "@/lib/incomes/revalidate";
import { incomeIdSchema } from "@/lib/incomes/schema";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { RECEIPT_FILE_MESSAGES, checkReceiptFile } from "./file";
import { receiptPath, type ReceiptNotice } from "./paths";
import {
  getIncomeWithReceipt,
  listPendingReceipts,
  recordReceipt,
  updateReceipt,
  type ReceiptLocation,
  type ReceiptRefusal,
  type SaveReceiptResult,
} from "./queries";
import {
  FILE_PATH_FIELD,
  RECEIPT_FIELD_MESSAGES,
  readReceiptFormValues,
  validateReceiptInput,
  type ReceiptField,
  type ReceiptFormValues,
} from "./schema";
import {
  checkUploadedReceipt,
  createReceiptUpload,
  isReceiptObjectPathOf,
  removeUnrecordedReceipt,
} from "./storage";

/**
 * Server Actions for receipts (DOC-1..5). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server,
 * including ids bound in the browser, which a caller can change.
 *
 * A PDF is uploaded by the browser straight to Storage (see storage.ts): the form first asks
 * prepareReceiptUploadAction for a signed upload URL, uploads, and then saves with the
 * object's path in FILE_PATH_FIELD. The save reads the stored object back and checks it
 * before the receipt is recorded; an upload that is not recorded is removed.
 */

export type ReceiptFormState = ServerFormState<ReceiptField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. פרטי הקבלה לא נשמרו, אפשר לנסות שוב.",
  incomeMissing: "ההכנסה לא נמצאה. ייתכן שנמחקה.",
  alreadyRecorded: "כבר נשמרה קבלה להכנסה הזו. אפשר לרענן את הדף כדי לראות אותה.",
  notRecorded: "עדיין לא נשמרה קבלה להכנסה הזו. אפשר לרענן את הדף ולשמור אותה.",
  fileMissing: "הקובץ לא הגיע לשמירה. יש לבחור את הקובץ שוב.",
  uploadUnavailable: "לא ניתן להעלות את הקובץ כרגע. אפשר לנסות שוב.",
} as const;

function refusedState(values: ReceiptFormValues, refusal: ReceiptRefusal): ReceiptFormState {
  switch (refusal) {
    case "doc_number_taken":
      return {
        values,
        fieldErrors: { doc_number: RECEIPT_FIELD_MESSAGES.docNumberTaken },
        formError: null,
      };
    case "date_in_future":
      return {
        values,
        fieldErrors: { issued_date: RECEIPT_FIELD_MESSAGES.issuedDateInFuture },
        formError: null,
      };
    case "file_missing":
      return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
    case "already_recorded":
      return { values, fieldErrors: {}, formError: MESSAGES.alreadyRecorded };
    case "income_missing":
      return { values, fieldErrors: {}, formError: MESSAGES.incomeMissing };
  }
}

export type PrepareUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; fieldError?: string; formError?: string };

const fileInfoSchema = z.object({
  size: z.number().int().min(0),
  type: z.string().max(200),
});

/**
 * DOC-2: a signed upload URL for a new receipt file of the income, after checking the file's
 * declared size and type (the stored object is checked again before it is recorded).
 */
export async function prepareReceiptUploadAction(
  incomeIdParam: string,
  fileParam: { size: number; type: string },
): Promise<PrepareUploadResult> {
  await requireAllowedUser();
  const incomeId = incomeIdSchema.safeParse(incomeIdParam);
  const file = fileInfoSchema.safeParse(fileParam);
  if (!incomeId.success || !file.success) {
    return { ok: false, formError: MESSAGES.incomeMissing };
  }
  const problem = checkReceiptFile(file.data);
  if (problem) {
    return { ok: false, fieldError: RECEIPT_FILE_MESSAGES[problem] };
  }
  try {
    return {
      ok: true,
      ...(await createReceiptUpload(await createSupabaseServerClient(), incomeId.data)),
    };
  } catch (error) {
    // Also an income that does not exist or is deleted: the insert policy refuses its path.
    logDbFailure("documents", "prepare upload", error);
    return { ok: false, formError: MESSAGES.uploadUnavailable };
  }
}

type Mode = "record" | "update";

/**
 * Validates and saves: records a new receipt, or changes the details of the recorded one.
 * In update mode, a "file" receipt without a new upload keeps its current file.
 */
async function saveReceiptForm(
  mode: Mode,
  incomeIdParam: string,
  formData: FormData,
): Promise<ReceiptFormState> {
  const values = readReceiptFormValues(formData);
  const incomeId = incomeIdSchema.safeParse(incomeIdParam);
  if (!incomeId.success) {
    return { values, fieldErrors: {}, formError: MESSAGES.incomeMissing };
  }
  const uploadedPathValue = formData.get(FILE_PATH_FIELD);
  const uploadedPath =
    typeof uploadedPathValue === "string" && uploadedPathValue !== "" ? uploadedPathValue : null;
  const supabase = await createSupabaseServerClient();
  // Whatever happens next, an upload that does not end up recorded is removed.
  let recorded = false;
  try {
    const validation = validateReceiptInput(values, todayInJerusalem());
    if (!validation.success) {
      return { values, fieldErrors: validation.fieldErrors, formError: null };
    }
    const input = validation.data;

    let current: Awaited<ReturnType<typeof getIncomeWithReceipt>>;
    try {
      current = await getIncomeWithReceipt(supabase, incomeId.data);
    } catch (error) {
      logDbFailure("documents", "read before save", error);
      return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
    }
    if (!current) {
      return { values, fieldErrors: {}, formError: MESSAGES.incomeMissing };
    }
    if (mode === "record" && current.document) {
      return { values, fieldErrors: {}, formError: MESSAGES.alreadyRecorded };
    }
    if (mode === "update" && !current.document) {
      return { values, fieldErrors: {}, formError: MESSAGES.notRecorded };
    }

    let location: ReceiptLocation;
    if (input.url !== null) {
      location = { file_path: null, url: input.url };
    } else if (uploadedPath !== null) {
      if (!isReceiptObjectPathOf(incomeId.data, uploadedPath)) {
        return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
      }
      const check = await checkUploadedReceipt(supabase, uploadedPath);
      if (check.status === "missing") {
        return { values, fieldErrors: { file: MESSAGES.fileMissing }, formError: null };
      }
      if (check.status === "invalid") {
        return {
          values,
          fieldErrors: { file: RECEIPT_FILE_MESSAGES[check.error] },
          formError: null,
        };
      }
      location = { file_path: uploadedPath, url: null };
    } else if (mode === "update" && current.document?.file_path) {
      location = { file_path: current.document.file_path, url: null };
    } else {
      return { values, fieldErrors: { file: RECEIPT_FILE_MESSAGES.required }, formError: null };
    }

    const details = { doc_number: input.doc_number, issued_date: input.issued_date, ...location };
    let result: SaveReceiptResult;
    try {
      result =
        mode === "record"
          ? await recordReceipt(supabase, incomeId.data, details)
          : await updateReceipt(supabase, incomeId.data, details);
    } catch (error) {
      logDbFailure("documents", mode, error);
      return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
    }
    if (result.status === "not_found") {
      return { values, fieldErrors: {}, formError: MESSAGES.notRecorded };
    }
    if (result.status === "refused") {
      return refusedState(values, result.refusal);
    }
    recorded = location.file_path === uploadedPath;
  } catch (error) {
    logDbFailure("documents", `${mode} check upload`, error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  } finally {
    if (uploadedPath !== null && !recorded) {
      await removeUnrecordedReceipt(supabase, uploadedPath);
    }
  }
  revalidateIncomeScreens();
  const notice: ReceiptNotice = mode === "record" ? "recorded" : "updated";
  redirect(withNotice(receiptPath(incomeId.data), notice));
}

/** DOC-2: records the receipt issued at the provider; the income becomes receipt_issued. */
export async function recordReceiptAction(
  incomeId: string,
  _previous: ReceiptFormState,
  formData: FormData,
): Promise<ReceiptFormState> {
  await requireAllowedUser();
  return saveReceiptForm("record", incomeId, formData);
}

/** Owner decision (M2.2): edits the recorded receipt's details (audited, never deleted). */
export async function updateReceiptAction(
  incomeId: string,
  _previous: ReceiptFormState,
  formData: FormData,
): Promise<ReceiptFormState> {
  await requireAllowedUser();
  return saveReceiptForm("update", incomeId, formData);
}

export type LoadPendingReceiptsResult = { ok: true; page: IncomeListPage } | { ok: false };

const offsetSchema = z.number().int().min(0);

/** DOC-5: the next page of the incomes waiting for a receipt ("load more"). */
export async function loadPendingReceiptsAction(
  offsetParam: number,
): Promise<LoadPendingReceiptsResult> {
  await requireAllowedUser();
  const offset = offsetSchema.safeParse(offsetParam);
  if (!offset.success) {
    return { ok: false };
  }
  try {
    return {
      ok: true,
      page: await listPendingReceipts(await createSupabaseServerClient(), offset.data),
    };
  } catch (error) {
    logDbFailure("documents", "list pending", error);
    return { ok: false };
  }
}
