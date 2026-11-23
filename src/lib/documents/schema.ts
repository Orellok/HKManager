import { requiredDateField } from "@/lib/field-rules";
import { readFormValues, validateForm, type ValidationResult } from "@/lib/forms";
import { z } from "@/lib/zod";

/**
 * The receipt form (DOC-2, DOC-3), shared by the form in the browser and the Server Actions:
 * the receipt number, the issue date and where the receipt is: an uploaded PDF ("file") or
 * an https link ("link", owner decision). The file itself is checked separately (file.ts),
 * since it never travels in the form data. The database repeats these rules.
 */

/** The fields in display order; "file" is the PDF input, validated outside the schema. */
export const RECEIPT_FIELDS = ["doc_number", "issued_date", "source", "file", "url"] as const;

export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

/** The fields read from the form data ("file" is never sent: the browser uploads it). */
const RECEIPT_VALUE_FIELDS = ["doc_number", "issued_date", "source", "url"] as const;

/**
 * The form field that carries the Storage path of the file the browser uploaded (set by the
 * form after the upload; the server checks it belongs to the income).
 */
export const FILE_PATH_FIELD = "file_path";

export const RECEIPT_SOURCES = ["file", "link"] as const;

export type ReceiptSource = (typeof RECEIPT_SOURCES)[number];

export const DOC_NUMBER_MAX_LENGTH = 30;
export const RECEIPT_URL_MAX_LENGTH = 2000;

/** "-" and "/" are allowed inside a receipt number, but not as its first character. */
const LEADING_SYMBOL_PATTERN = /^[-/]/;
/** Mirrors documents_doc_number_check. */
const DOC_NUMBER_PATTERN = /^[0-9A-Za-z][0-9A-Za-z/-]*$/;
/** Mirrors documents_url_check: https, a host, then optionally a path, query or fragment. */
const HTTPS_URL_PATTERN = /^https:\/\/[^/?#\s]+([/?#]\S*)?$/;

export const RECEIPT_FIELD_MESSAGES = {
  docNumberRequired: "יש להזין את מספר הקבלה.",
  docNumberInvalid: `מספר הקבלה יכול לכלול ספרות, אותיות באנגלית, מקף ולוכסן, עד ${DOC_NUMBER_MAX_LENGTH} תווים.`,
  docNumberLeadingSymbol: "מספר הקבלה צריך להתחיל בספרה או באות באנגלית, לא במקף או בלוכסן.",
  docNumberTaken: "מספר הקבלה הזה כבר רשום לקבלה אחרת. יש לבדוק את המספר.",
  issuedDateRequired: "יש להזין את תאריך הפקת הקבלה.",
  issuedDateInFuture: "תאריך הפקת הקבלה לא יכול להיות בעתיד.",
  sourceRequired: "יש לבחור אם להעלות קובץ PDF או להדביק קישור.",
  urlRequired: "יש להדביק את הקישור לקבלה.",
  urlNotHttps: "הקישור חייב להתחיל ב-https://.",
  urlInvalid: "הקישור אינו תקין. יש להעתיק אותו שוב ממערכת הספק.",
  urlTooLong: `הקישור ארוך מדי (עד ${RECEIPT_URL_MAX_LENGTH} תווים).`,
} as const;

function urlProblem(url: string): string | null {
  if (url === "") {
    return RECEIPT_FIELD_MESSAGES.urlRequired;
  }
  if (!url.toLowerCase().startsWith("https://")) {
    return RECEIPT_FIELD_MESSAGES.urlNotHttps;
  }
  if (url.length > RECEIPT_URL_MAX_LENGTH) {
    return RECEIPT_FIELD_MESSAGES.urlTooLong;
  }
  if (!url.startsWith("https://") || !HTTPS_URL_PATTERN.test(url) || !URL.canParse(url)) {
    return RECEIPT_FIELD_MESSAGES.urlInvalid;
  }
  return null;
}

/** The receipt schema for a given today (ISO date in Asia/Jerusalem, todayInJerusalem()). */
export function receiptInputSchema(today: string) {
  return z
    .object({
      doc_number: z
        .string()
        .trim()
        .min(1, { error: RECEIPT_FIELD_MESSAGES.docNumberRequired, abort: true })
        .max(DOC_NUMBER_MAX_LENGTH, { error: RECEIPT_FIELD_MESSAGES.docNumberInvalid, abort: true })
        .refine((value) => !LEADING_SYMBOL_PATTERN.test(value), {
          error: RECEIPT_FIELD_MESSAGES.docNumberLeadingSymbol,
          abort: true,
        })
        .regex(DOC_NUMBER_PATTERN, { error: RECEIPT_FIELD_MESSAGES.docNumberInvalid }),
      issued_date: requiredDateField(RECEIPT_FIELD_MESSAGES.issuedDateRequired).refine(
        (value) => value <= today,
        { error: RECEIPT_FIELD_MESSAGES.issuedDateInFuture },
      ),
      source: z.enum(RECEIPT_SOURCES, { error: RECEIPT_FIELD_MESSAGES.sourceRequired }),
      url: z.string().trim(),
    })
    .superRefine((receipt, context) => {
      if (receipt.source !== "link") {
        return;
      }
      const problem = urlProblem(receipt.url);
      if (problem) {
        context.addIssue({ code: "custom", message: problem, path: ["url"] });
      }
    })
    .transform((receipt) => ({
      ...receipt,
      url: receipt.source === "link" ? receipt.url : null,
    }));
}

/** What the user typed, as strings; kept so a failed save never loses input. */
export type ReceiptFormValues = Record<ReceiptField, string>;

/** A validated receipt (the file is checked and uploaded separately). */
export type ReceiptInput = z.output<ReturnType<typeof receiptInputSchema>>;

/** Reads the receipt fields from a submitted form; "file" always reads as "". */
export function readReceiptFormValues(formData: FormData): ReceiptFormValues {
  return { ...readFormValues(formData, RECEIPT_VALUE_FIELDS), file: "" };
}

/** Validates form values for `today`; on failure returns the first message per field. */
export function validateReceiptInput(
  values: ReceiptFormValues,
  today: string,
): ValidationResult<ReceiptField, ReceiptInput> {
  return validateForm(receiptInputSchema(today), RECEIPT_FIELDS, values);
}
