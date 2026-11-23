import { requiredAmountField, requiredDateField } from "@/lib/field-rules";
import {
  emptyToNull,
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type ValidationResult,
} from "@/lib/forms";
import { PAYMENT_METHODS } from "@/lib/incomes/payment-methods";
import { z } from "@/lib/zod";

/**
 * The expense form schema (EXP-1), shared by the form in the browser and the Server Actions.
 * Required: date, amount, vendor, category, payment method (the incomes' list); notes and the
 * file are optional (EXP-6: without a file the expense is marked "חסר מסמך"). Owner decisions
 * (M3): the amount is more than 0 and the date is not in the future (Asia/Jerusalem), so the
 * schema is built for a given "today". The file itself is checked separately (file.ts): it
 * never travels in the form data. The database repeats these rules.
 */

/** The fields in display order; "file" is the receipt input, validated outside the schema. */
export const EXPENSE_FIELDS = [
  "expense_date",
  "amount",
  "vendor",
  "category_id",
  "payment_method",
  "notes",
  "file",
] as const;

export type ExpenseField = (typeof EXPENSE_FIELDS)[number];

/** The fields read from the form data ("file" is never sent: the browser uploads it). */
const EXPENSE_VALUE_FIELDS = [
  "expense_date",
  "amount",
  "vendor",
  "category_id",
  "payment_method",
  "notes",
] as const;

/**
 * The form field that carries the Storage path of the file the browser uploaded (set by the
 * form after the upload; the server checks the stored file before recording it).
 */
export const EXPENSE_FILE_PATH_FIELD = "file_path";

export const VENDOR_MAX_LENGTH = 120;
export const EXPENSE_NOTES_MAX_LENGTH = 2000;

export const EXPENSE_FIELD_MESSAGES = {
  dateRequired: "יש להזין את תאריך ההוצאה.",
  dateInFuture: "תאריך ההוצאה לא יכול להיות בעתיד.",
  amountRequired: "יש להזין סכום.",
  amountNotPositive: "הסכום חייב להיות גדול מ-0.",
  vendorRequired: "יש להזין את שם הספק.",
  vendorTooLong: `שם הספק ארוך מדי (עד ${VENDOR_MAX_LENGTH} תווים).`,
  categoryRequired: "יש לבחור קטגוריה.",
  categoryArchived: "הקטגוריה הועברה לארכיון. יש לבחור קטגוריה אחרת.",
  paymentMethodRequired: "יש לבחור אמצעי תשלום.",
  notesTooLong: `ההערות ארוכות מדי (עד ${EXPENSE_NOTES_MAX_LENGTH} תווים).`,
} as const;

/** Expense ids are uuids; anything else cannot name one. */
export const expenseIdSchema = z.uuid();

/** The expense schema for a given today (ISO date in Asia/Jerusalem, todayInJerusalem()). */
export function expenseInputSchema(today: string) {
  return z.object({
    expense_date: requiredDateField(EXPENSE_FIELD_MESSAGES.dateRequired).refine(
      (value) => value <= today,
      { error: EXPENSE_FIELD_MESSAGES.dateInFuture },
    ),
    amount: requiredAmountField(EXPENSE_FIELD_MESSAGES.amountRequired).refine(
      (agorot) => agorot > 0,
      { error: EXPENSE_FIELD_MESSAGES.amountNotPositive },
    ),
    vendor: z
      .string()
      .trim()
      .min(1, { error: EXPENSE_FIELD_MESSAGES.vendorRequired, abort: true })
      .max(VENDOR_MAX_LENGTH, { error: EXPENSE_FIELD_MESSAGES.vendorTooLong }),
    category_id: z
      .string()
      .trim()
      .pipe(z.uuid({ error: EXPENSE_FIELD_MESSAGES.categoryRequired })),
    payment_method: z.enum(PAYMENT_METHODS, {
      error: EXPENSE_FIELD_MESSAGES.paymentMethodRequired,
    }),
    notes: withNormalizedLineBreaks(
      z
        .string()
        .trim()
        .max(EXPENSE_NOTES_MAX_LENGTH, { error: EXPENSE_FIELD_MESSAGES.notesTooLong })
        .transform(emptyToNull),
    ),
  });
}

/** What the user typed, as strings; kept so a failed save never loses input. */
export type ExpenseFormValues = Record<ExpenseField, string>;

/** A validated expense, ready to store (amount in agorot). */
export type ExpenseInput = z.output<ReturnType<typeof expenseInputSchema>>;

export const EMPTY_EXPENSE_FORM_VALUES: ExpenseFormValues = {
  expense_date: "",
  amount: "",
  vendor: "",
  category_id: "",
  payment_method: "",
  notes: "",
  file: "",
};

/** Reads the expense fields from a submitted form; "file" always reads as "". */
export function readExpenseFormValues(formData: FormData): ExpenseFormValues {
  return { ...readFormValues(formData, EXPENSE_VALUE_FIELDS), file: "" };
}

/** Validates form values for `today`; on failure returns the first message per field. */
export function validateExpenseInput(
  values: ExpenseFormValues,
  today: string,
): ValidationResult<ExpenseField, ExpenseInput> {
  return validateForm(expenseInputSchema(today), EXPENSE_FIELDS, values);
}
