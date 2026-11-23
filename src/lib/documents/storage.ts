import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSignedUpload,
  createViewUrl,
  downloadObject,
  removeUnrecordedObject,
  type SignedUpload,
} from "@/lib/files/private-storage";

import { RECEIPTS_BUCKET, checkReceiptFileContent, type ReceiptFileError } from "./file";

/**
 * Receipt PDFs in the private "receipts" Storage bucket (DOC-2), following the shared
 * signed-upload pattern (src/lib/files/private-storage.ts). Server only. A receipt's path is
 * <income id>/<random uuid>.pdf: no personal data (SPEC 8). Before a document is recorded,
 * the server reads the stored object back and checks its size, type and PDF signature.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A new, random object path for a receipt file of the income. */
export function newReceiptObjectPath(incomeId: string): string {
  return `${incomeId}/${randomUUID()}.pdf`;
}

/** Whether `path` is a receipt object path of the income (as newReceiptObjectPath makes). */
export function isReceiptObjectPathOf(incomeId: string, path: string): boolean {
  return new RegExp(`^${UUID}/${UUID}\\.pdf$`).test(path) && path.startsWith(`${incomeId}/`);
}

export type { SignedUpload };

/** A one-time signed upload URL token for a new object path of the income. */
export async function createReceiptUpload(
  supabase: SupabaseClient,
  incomeId: string,
): Promise<SignedUpload> {
  return createSignedUpload(supabase, RECEIPTS_BUCKET, newReceiptObjectPath(incomeId));
}

export type UploadedFileCheck =
  { status: "ok" } | { status: "missing" } | { status: "invalid"; error: ReceiptFileError };

/** Reads an uploaded object back and checks its size, type and PDF signature. */
export async function checkUploadedReceipt(
  supabase: SupabaseClient,
  path: string,
): Promise<UploadedFileCheck> {
  const data = await downloadObject(supabase, RECEIPTS_BUCKET, path);
  if (!data) {
    return { status: "missing" };
  }
  const problem = await checkReceiptFileContent(data);
  return problem ? { status: "invalid", error: problem } : { status: "ok" };
}

/** Removes an upload that was not recorded (best effort, see removeUnrecordedObject). */
export async function removeUnrecordedReceipt(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  await removeUnrecordedObject(supabase, RECEIPTS_BUCKET, path, "documents");
}

/** DOC-2: a short-lived signed URL that shows the receipt file. */
export async function createReceiptViewUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  return createViewUrl(supabase, RECEIPTS_BUCKET, path);
}
