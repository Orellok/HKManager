import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * The browser side of the signed-upload pattern (src/lib/files/private-storage.ts): sends a
 * file straight to a private bucket with the one-time token the server handed out, and
 * removes an upload the server answered it did not record.
 */

/** Uploads `file` to `path` with the signed upload token; false when the upload failed. */
export async function uploadToSignedPath(
  bucket: string,
  path: string,
  token: string,
  file: Blob,
): Promise<boolean> {
  try {
    const { error } = await createSupabaseBrowserClient()
      .storage.from(bucket)
      .uploadToSignedUrl(path, token, file);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Removes an upload the server answered it did not save, best effort (the server's own
 * removal may have failed). Never call it after a failed request: the save may have reached
 * the server and be committing; the bucket's policy and the lock taken by the recording
 * refuse removing a recorded file in any case.
 */
export function removeRejectedUpload(bucket: string, path: string): void {
  createSupabaseBrowserClient()
    .storage.from(bucket)
    .remove([path])
    .catch(() => {
      // Nothing to do: an upload left behind is unreferenced and harmless.
    });
}
