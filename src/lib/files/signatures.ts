/**
 * File signatures ("magic bytes"): the first bytes that identify a file's real format,
 * whatever type the browser or the system declared for it. Checked in the browser before
 * uploading and on the server on the stored object (receipts DOC-2, expenses EXP-2).
 */

export const PDF_MIME_TYPE = "application/pdf";
export const JPEG_MIME_TYPE = "image/jpeg";
export const PNG_MIME_TYPE = "image/png";

export type SignedFileType = typeof PDF_MIME_TYPE | typeof JPEG_MIME_TYPE | typeof PNG_MIME_TYPE;

const SIGNATURES: Record<SignedFileType, readonly number[]> = {
  // "%PDF-"
  [PDF_MIME_TYPE]: [0x25, 0x50, 0x44, 0x46, 0x2d],
  // SOI marker followed by the first marker's 0xFF.
  [JPEG_MIME_TYPE]: [0xff, 0xd8, 0xff],
  // "\x89PNG\r\n\x1a\n"
  [PNG_MIME_TYPE]: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/** Bytes to read from the start of a file to check any of the signatures above. */
export const SIGNATURE_LENGTH = Math.max(
  ...Object.values(SIGNATURES).map((signature) => signature.length),
);

/** Whether the first bytes of a file are the signature of `type`. */
export function hasSignature(type: SignedFileType, firstBytes: Uint8Array): boolean {
  return SIGNATURES[type].every((byte, index) => firstBytes[index] === byte);
}

/** The first SIGNATURE_LENGTH bytes of a file (fewer when the file is shorter). */
export async function readFirstBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, SIGNATURE_LENGTH).arrayBuffer());
}
