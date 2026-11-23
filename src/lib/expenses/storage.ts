import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSignedUpload,
  createViewUrl,
  downloadObject,
  removeUnrecordedObject,
  type SignedUpload,
} from "@/lib/files/private-storage";

import {
  EXPENSE_FILES_BUCKET,
  checkUploadFileContent,
  extensionFor,
  typeOfPath,
  type ExpenseFileError,
  type ExpenseFileType,
} from "./file";

/**
 * Expense files in the private "expense-files" bucket (EXP-2), following the shared
 * signed-upload pattern (src/lib/files/private-storage.ts). Server only. An expense's file
 * is uploaded before the expense is saved (a new expense has no id yet), so its path is a
 * random name at the bucket's root, <random uuid>.<jpg|png|pdf>: no personal data (SPEC 8).
 */

const OBJECT_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$/;

/** A new, random object path for a file of `type`. */
export function newExpenseObjectPath(type: ExpenseFileType): string {
  return `${randomUUID()}.${extensionFor(type)}`;
}

/** Whether `path` has the shape newExpenseObjectPath makes. */
export function isExpenseObjectPath(path: string): boolean {
  return OBJECT_PATH_PATTERN.test(path);
}

/** A one-time signed upload URL token for a new object path for a file of `type`. */
export async function createExpenseUpload(
  supabase: SupabaseClient,
  type: ExpenseFileType,
): Promise<SignedUpload> {
  return createSignedUpload(supabase, EXPENSE_FILES_BUCKET, newExpenseObjectPath(type));
}

export type UploadedExpenseFileCheck =
  { status: "ok" } | { status: "missing" } | { status: "invalid"; error: ExpenseFileError };

/**
 * Reads an uploaded object back and checks it: its stored type is the one its name says,
 * its size, and its signature.
 */
export async function checkUploadedExpenseFile(
  supabase: SupabaseClient,
  path: string,
): Promise<UploadedExpenseFileCheck> {
  const data = await downloadObject(supabase, EXPENSE_FILES_BUCKET, path);
  if (!data) {
    return { status: "missing" };
  }
  if (data.type !== typeOfPath(path)) {
    return { status: "invalid", error: "not_matching" };
  }
  const problem = await checkUploadFileContent(data);
  return problem ? { status: "invalid", error: problem } : { status: "ok" };
}

/** Removes an upload that was not recorded (best effort, see removeUnrecordedObject). */
export async function removeUnrecordedExpenseFile(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  await removeUnrecordedObject(supabase, EXPENSE_FILES_BUCKET, path, "expenses");
}

/** EXP-2: a short-lived signed URL that shows the expense's file. */
export async function createExpenseFileViewUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  return createViewUrl(supabase, EXPENSE_FILES_BUCKET, path);
}
