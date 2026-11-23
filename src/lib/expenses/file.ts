import {
  JPEG_MIME_TYPE,
  PDF_MIME_TYPE,
  PNG_MIME_TYPE,
  hasSignature,
  readFirstBytes,
  type SignedFileType,
} from "@/lib/files/signatures";

/**
 * EXP-2 / owner decision (M3): an expense's receipt is a JPEG, PNG or PDF. Images are
 * compressed in the browser to a JPEG (src/lib/expenses/compress.ts) before upload; what is
 * uploaded is at most 10MB. The same rules run in the browser and on the server (on the
 * stored object, before the expense records it); the bucket repeats the types and the size.
 */

/** The private Storage bucket of expense files (created by the expenses migration). */
export const EXPENSE_FILES_BUCKET = "expense-files";

/** 10MB after compression, as the bucket's file_size_limit (10485760 bytes). */
export const EXPENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * A chosen photo larger than this is not decoded at all: a phone could run out of memory
 * before compression gets a chance (phone photos are a few MB).
 */
export const IMAGE_INPUT_MAX_BYTES = 40 * 1024 * 1024;

export const EXPENSE_FILE_TYPES = [JPEG_MIME_TYPE, PNG_MIME_TYPE, PDF_MIME_TYPE] as const;

export type ExpenseFileType = (typeof EXPENSE_FILE_TYPES)[number] & SignedFileType;

const EXTENSIONS: Record<ExpenseFileType, string> = {
  [JPEG_MIME_TYPE]: "jpg",
  [PNG_MIME_TYPE]: "png",
  [PDF_MIME_TYPE]: "pdf",
};

/** What the file inputs accept: the types, and extensions for pickers that go by name. */
export const EXPENSE_FILE_ACCEPT = `${EXPENSE_FILE_TYPES.join(",")},.jpg,.jpeg,.png,.pdf`;

export type ExpenseFileError =
  "empty" | "too_large" | "image_too_large" | "unsupported" | "not_matching" | "unreadable_image";

export const EXPENSE_FILE_MESSAGES: Record<ExpenseFileError, string> = {
  empty: "הקובץ ריק. יש לבחור קובץ אחר או לצלם שוב.",
  too_large: "הקובץ גדול מדי. אפשר להעלות קובץ של עד 10MB.",
  image_too_large: "התמונה גדולה מדי לעיבוד (עד 40MB). אפשר לצלם שוב או לבחור תמונה קטנה יותר.",
  unsupported: "אפשר לצרף רק תמונה (JPEG או PNG) או קובץ PDF.",
  not_matching: "תוכן הקובץ אינו תמונה (JPEG או PNG) או PDF. יש לבחור קובץ אחר.",
  unreadable_image: "לא הצלחנו לקרוא את התמונה. אפשר לצלם שוב או לבחור קובץ אחר.",
};

export function isExpenseFileType(type: string): type is ExpenseFileType {
  return (EXPENSE_FILE_TYPES as readonly string[]).includes(type);
}

/** Images are compressed before upload; a PDF goes as it is. */
export function isImageType(type: string): boolean {
  return type === JPEG_MIME_TYPE || type === PNG_MIME_TYPE;
}

export function extensionFor(type: ExpenseFileType): string {
  return EXTENSIONS[type];
}

/** The type of a stored object by its extension, or null for any other name. */
export function typeOfPath(path: string): ExpenseFileType | null {
  const extension = path.slice(path.lastIndexOf(".") + 1);
  const match = EXPENSE_FILE_TYPES.find((type) => EXTENSIONS[type] === extension);
  return match ?? null;
}

/**
 * A file the user chose, before compression: a supported type, not empty, and not too large
 * to handle (a PDF is uploaded as it is, so it must already fit; an image is checked again
 * after compression).
 */
export function checkChosenFile(file: { size: number; type: string }): ExpenseFileError | null {
  if (!isExpenseFileType(file.type)) {
    return "unsupported";
  }
  if (file.size === 0) {
    return "empty";
  }
  if (isImageType(file.type)) {
    return file.size > IMAGE_INPUT_MAX_BYTES ? "image_too_large" : null;
  }
  return file.size > EXPENSE_FILE_MAX_BYTES ? "too_large" : null;
}

/** A file about to be uploaded (after compression): type and size. */
export function checkUploadFile(file: { size: number; type: string }): ExpenseFileError | null {
  if (!isExpenseFileType(file.type)) {
    return "unsupported";
  }
  if (file.size === 0) {
    return "empty";
  }
  return file.size > EXPENSE_FILE_MAX_BYTES ? "too_large" : null;
}

/** A whole file: type and size, and its first bytes are the signature of its type. */
export async function checkUploadFileContent(file: Blob): Promise<ExpenseFileError | null> {
  const problem = checkUploadFile(file);
  if (problem) {
    return problem;
  }
  const type = file.type;
  return isExpenseFileType(type) && hasSignature(type, await readFirstBytes(file))
    ? null
    : "not_matching";
}
