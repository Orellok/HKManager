/**
 * DOC-2 / owner decision: a receipt file is a PDF of at most 10MB. The same rules run in the
 * browser (before uploading) and on the server (on the stored object, before recording it);
 * the Storage bucket repeats the type and size limits.
 */

/** The private Storage bucket of receipt files (created by the documents migration). */
export const RECEIPTS_BUCKET = "receipts";

/** 10MB, as the bucket's file_size_limit (10485760 bytes). */
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const PDF_MIME_TYPE = "application/pdf";

/** Every PDF file starts with "%PDF-". */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/** Bytes to read from the start of a file to check it is a PDF. */
export const PDF_MAGIC_LENGTH = PDF_MAGIC.length;

export type ReceiptFileError = "empty" | "too_large" | "not_pdf";

export const RECEIPT_FILE_MESSAGES: Record<ReceiptFileError | "required", string> = {
  required: "יש לבחור קובץ PDF של הקבלה.",
  empty: "הקובץ ריק. יש לבחור את קובץ ה-PDF של הקבלה.",
  too_large: "הקובץ גדול מדי. אפשר להעלות קובץ PDF של עד 10MB.",
  not_pdf: "אפשר להעלות רק קובץ PDF.",
};

/** Whether the first bytes of a file are the PDF signature "%PDF-". */
export function hasPdfSignature(firstBytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => firstBytes[index] === byte);
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
  const firstBytes = new Uint8Array(await file.slice(0, PDF_MAGIC_LENGTH).arrayBuffer());
  return hasPdfSignature(firstBytes) ? null : "not_pdf";
}
