import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { RECEIPTS_BUCKET, checkReceiptFileContent, type ReceiptFileError } from "./file";

/**
 * Receipt PDFs in the private "receipts" Storage bucket (DOC-2), reached with the caller's
 * session, so the storage.objects policies apply (allowlisted users only). Server only.
 *
 * Uploads go straight from the browser to Storage with a signed upload URL for a path the
 * server chose, <income id>/<random uuid>.pdf: no personal data in the path (SPEC 8), and
 * the file never passes through a Server Action or the hosting platform's request size
 * limits. Before a document is recorded, the server reads the stored object back and checks
 * its size, type and PDF signature.
 */

/** Viewing links (signed URLs) expire after this many seconds. */
export const RECEIPT_VIEW_URL_SECONDS = 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A new, random object path for a receipt file of the income. */
export function newReceiptObjectPath(incomeId: string): string {
  return `${incomeId}/${randomUUID()}.pdf`;
}

/** Whether `path` is a receipt object path of the income (as newReceiptObjectPath makes). */
export function isReceiptObjectPathOf(incomeId: string, path: string): boolean {
  return new RegExp(`^${UUID}/${UUID}\\.pdf$`).test(path) && path.startsWith(`${incomeId}/`);
}

export type SignedUpload = { path: string; token: string };

/** A one-time signed upload URL token for a new object path of the income. */
export async function createReceiptUpload(
  supabase: SupabaseClient,
  incomeId: string,
): Promise<SignedUpload> {
  const path = newReceiptObjectPath(incomeId);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUploadUrl(path);
  if (error) {
    throw new Error("Could not create a signed upload URL", { cause: error });
  }
  return { path: data.path, token: data.token };
}

export type UploadedFileCheck =
  { status: "ok" } | { status: "missing" } | { status: "invalid"; error: ReceiptFileError };

/** Reads an uploaded object back and checks its size, type and PDF signature. */
export async function checkUploadedReceipt(
  supabase: SupabaseClient,
  path: string,
): Promise<UploadedFileCheck> {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(path);
  if (error) {
    if (isNotFound(error)) {
      return { status: "missing" };
    }
    throw new Error("Could not read the uploaded receipt", { cause: error });
  }
  const problem = await checkReceiptFileContent(data);
  return problem ? { status: "invalid", error: problem } : { status: "ok" };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = "status" in error ? error.status : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  return status === 400 || status === 404 || statusCode === "404" || statusCode === "400";
}

/**
 * Removes an upload that was not recorded (it failed the checks, or the save failed). A
 * failure is logged and otherwise ignored: the object stays unreferenced and harmless.
 */
export async function removeUnrecordedReceipt(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
  if (error) {
    console.error("documents: remove unrecorded upload failed");
  }
}

/** DOC-2: a signed URL that shows the receipt file for RECEIPT_VIEW_URL_SECONDS. */
export async function createReceiptViewUrl(
  supabase: SupabaseClient,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .createSignedUrl(path, RECEIPT_VIEW_URL_SECONDS);
  if (error) {
    throw new Error("Could not create a signed URL for the receipt", { cause: error });
  }
  return data.signedUrl;
}
