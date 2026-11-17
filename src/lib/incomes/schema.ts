import { requiredAmountField, requiredDateField } from "@/lib/field-rules";
import {
  emptyToNull,
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type FieldErrors,
  type ValidationResult,
} from "@/lib/forms";
import { z } from "@/lib/zod";

import { PAYMENT_METHODS } from "./payment-methods";

/**
 * The income form schema (INC-1, INC-2, INC-5), shared by the form in the browser and the
 * Server Actions. Required: client, received date, amount, payment method; project and
 * milestone are optional (an income without a project is allowed, INC-2), and a milestone
 * comes with its project. Owner decisions (M2.1): the amount is more than 0 and the received
 * date is not in the future (Asia/Jerusalem), so the schema is built for a given "today".
 * The database repeats these rules (check constraints and the incomes_check_references
 * trigger).
 */

export const INCOME_FIELDS = [
  "client_id",
  "project_id",
  "milestone_id",
  "received_date",
  "amount",
  "payment_method",
  "notes",
] as const;

export type IncomeField = (typeof INCOME_FIELDS)[number];

export const INCOME_NOTES_MAX_LENGTH = 2000;

export const INCOME_FIELD_MESSAGES = {
  clientRequired: "יש לבחור לקוח.",
  choiceInvalid: "הבחירה אינה תקינה. יש לבחור שוב.",
  milestoneNeedsProject: "יש לבחור את הפרויקט של אבן הדרך.",
  receivedDateRequired: "יש להזין את תאריך קבלת התשלום.",
  receivedDateInFuture: "תאריך קבלת התשלום לא יכול להיות בעתיד.",
  amountRequired: "יש להזין סכום.",
  amountNotPositive: "הסכום חייב להיות גדול מ-0.",
  paymentMethodRequired: "יש לבחור אמצעי תשלום.",
  notesTooLong: `ההערות ארוכות מדי (עד ${INCOME_NOTES_MAX_LENGTH} תווים).`,
} as const;

/** Income ids are uuids; anything else cannot name one. */
export const incomeIdSchema = z.uuid();

/** An optional id from a select: "" → null, otherwise a uuid. */
function optionalId() {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || incomeIdSchema.safeParse(value).success, {
      error: INCOME_FIELD_MESSAGES.choiceInvalid,
    })
    .transform(emptyToNull);
}

/** The income schema for a given today (ISO date in Asia/Jerusalem, todayInJerusalem()). */
export function incomeInputSchema(today: string) {
  return z
    .object({
      client_id: z
        .string()
        .trim()
        .pipe(z.uuid({ error: INCOME_FIELD_MESSAGES.clientRequired })),
      project_id: optionalId(),
      milestone_id: optionalId(),
      received_date: requiredDateField(INCOME_FIELD_MESSAGES.receivedDateRequired).refine(
        (value) => value <= today,
        { error: INCOME_FIELD_MESSAGES.receivedDateInFuture },
      ),
      amount: requiredAmountField(INCOME_FIELD_MESSAGES.amountRequired).refine(
        (agorot) => agorot > 0,
        { error: INCOME_FIELD_MESSAGES.amountNotPositive },
      ),
      payment_method: z.enum(PAYMENT_METHODS, {
        error: INCOME_FIELD_MESSAGES.paymentMethodRequired,
      }),
      notes: withNormalizedLineBreaks(
        z
          .string()
          .trim()
          .max(INCOME_NOTES_MAX_LENGTH, { error: INCOME_FIELD_MESSAGES.notesTooLong })
          .transform(emptyToNull),
      ),
    })
    .refine((income) => income.milestone_id === null || income.project_id !== null, {
      error: INCOME_FIELD_MESSAGES.milestoneNeedsProject,
      path: ["project_id"],
    });
}

/** What the user typed, as strings; kept so a failed save never loses input. */
export type IncomeFormValues = Record<IncomeField, string>;

/** A validated income, ready to store (amount in agorot). */
export type IncomeInput = z.output<ReturnType<typeof incomeInputSchema>>;

export type IncomeFieldErrors = FieldErrors<IncomeField>;

export const EMPTY_INCOME_FORM_VALUES: IncomeFormValues = {
  client_id: "",
  project_id: "",
  milestone_id: "",
  received_date: "",
  amount: "",
  payment_method: "",
  notes: "",
};

/** Reads the income fields from a submitted form. A missing or non-text field reads as "". */
export function readIncomeFormValues(formData: FormData): IncomeFormValues {
  return readFormValues(formData, INCOME_FIELDS);
}

/** Validates form values for `today`; on failure returns the first message per field. */
export function validateIncomeInput(
  values: IncomeFormValues,
  today: string,
): ValidationResult<IncomeField, IncomeInput> {
  return validateForm(incomeInputSchema(today), INCOME_FIELDS, values);
}
