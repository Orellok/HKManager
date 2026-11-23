import { PDF_MIME_TYPE, hasSignature, readFirstBytes } from "@/lib/files/signatures";

export { PDF_MIME_TYPE };

/**
 * DOC-2 / owner decision: a receipt file is a PDF of at most 10MB. The same rules run in the
 * browser (before uploading) and on the server (on the stored object, before recording it);
 * the Storage bucket repeats the type and size limits.
 */

/** The private Storage bucket of receipt files (created by the documents migration). */
export const RECEIPTS_BUCKET = "receipts";

/** 10MB, as the bucket's file_size_limit (10485760 bytes). */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export type ReceiptFileError = "empty" | "too_large" | "not_pdf";

export const RECEIPT_FILE_MESSAGES: Record<ReceiptFileError | "required", string> = {
  required: "יש לבחור קובץ PDF של הקבלה.",
  empty: "הקובץ ריק. יש לבחור את קובץ ה-PDF של הקבלה.",
  too_large: "הקובץ גדול מדי. אפשר להעלות קובץ PDF של עד 10MB.",
  not_pdf: "אפשר להעלות רק קובץ PDF.",
};

/** Whether the first bytes of a file are the PDF signature "%PDF-". */
export function hasPdfSignature(firstBytes: Uint8Array): boolean {
  return hasSignature(PDF_MIME_TYPE, firstBytes);
}

/** Checks a file's size and declared type; null when both are acceptable. */
export function checkReceiptFile(file: { size: number; type: string }): ReceiptFileError | null {
  if (file.size === 0) {
    return "empty";
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return "too_large";
  }
  if (file.type !== PDF_MIME_TYPE) {
    return "not_pdf";
  }
  return null;
}

/** Checks a whole file: size, declared type and the PDF signature; null when acceptable. */
export async function checkReceiptFileContent(file: Blob): Promise<ReceiptFileError | null> {
  const error = checkReceiptFile(file);
  if (error) {
    return error;
  }
  return hasPdfSignature(await readFirstBytes(file)) ? null : "not_pdf";
}
