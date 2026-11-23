import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Files in a private Storage bucket, reached with the caller's session, so the bucket's
 * storage.objects policies apply (allowlisted users only). Server only. The M2.2 pattern,
 * shared by receipts (DOC-2) and expenses (EXP-2):
 *
 * - the server chooses a random object path with no personal data (SPEC 8) and hands the
 *   browser a one-time signed upload URL for it, so the file never passes through a Server
 *   Action or the hosting platform's request size limits;
 * - before a record points to the file, the server reads the stored object back and checks
 *   it; an upload that does not end up recorded is removed (the buckets' policies refuse
 *   removing a file that was ever recorded);
 * - a file is viewed through a signed URL that expires after VIEW_URL_SECONDS.
 */

/** Viewing links (signed URLs) expire after this many seconds. */
export const VIEW_URL_SECONDS = 60;

export type SignedUpload = { path: string; token: string };

/** A one-time signed upload URL token for `path` in `bucket`. */
export async function createSignedUpload(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<SignedUpload> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (error) {
    throw new Error("Could not create a signed upload URL", { cause: error });
  }
  return { path: data.path, token: data.token };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const status = "status" in error ? error.status : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  return status === 400 || status === 404 || statusCode === "404" || statusCode === "400";
}

/** The stored object, or null when there is none at `path` (or it is not visible). */
export async function downloadObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new Error("Could not read the uploaded file", { cause: error });
  }
  return data;
}

/**
 * Removes an upload that was not recorded (it failed the checks, or the save failed). A
 * failure is logged by scope only and otherwise ignored: the object stays unreferenced and
 * harmless.
 */
export async function removeUnrecordedObject(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  scope: string,
): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) {
    console.error(`${scope}: remove unrecorded upload failed`);
  }
}

/** A signed URL that shows the file for VIEW_URL_SECONDS. */
export async function createViewUrl(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, VIEW_URL_SECONDS);
  if (error) {
    throw new Error("Could not create a signed URL for the file", { cause: error });
  }
  return data.signedUrl;
}
