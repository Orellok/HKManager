import { isIsoDate } from "@/lib/dates";
import {
  AMOUNT_MESSAGES,
  DATE_MESSAGES,
  optionalAmountField,
  optionalDateField,
} from "@/lib/field-rules";
import {
  emptyToNull,
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type FieldErrors,
  type ValidationResult,
} from "@/lib/forms";
import { z } from "@/lib/zod";

import { PROJECT_STATUSES } from "./status";

/**
 * The project form schema (PRJ-1, PRJ-2), shared by the form in the browser and the Server
 * Actions. Required: client, name, status. Owner decision (M1.2): the contract amount is
 * optional. Values are trimmed; an empty optional field is stored as null. The database
 * repeats these rules as check constraints.
 */

export const PROJECT_FIELDS = [
  "client_id",
  "name",
  "property_address",
  "status",
  "contract_amount",
  "start_date",
  "end_date",
  "notes",
] as const;

export type ProjectField = (typeof PROJECT_FIELDS)[number];

export const PROJECT_TEXT_MAX_LENGTH = {
  name: 120,
  property_address: 200,
  notes: 2000,
} as const;

export const PROJECT_FIELD_MESSAGES = {
  clientRequired: "יש לבחור לקוח.",
  clientArchived: "הלקוח בארכיון. כדי לפתוח לו פרויקט, יש לשחזר אותו קודם מהארכיון.",
  nameRequired: "יש להזין שם פרויקט.",
  nameTooLong: `השם ארוך מדי (עד ${PROJECT_TEXT_MAX_LENGTH.name} תווים).`,
  propertyAddressTooLong: `כתובת הנכס ארוכה מדי (עד ${PROJECT_TEXT_MAX_LENGTH.property_address} תווים).`,
  statusRequired: "יש לבחור סטטוס.",
  amountInvalid: AMOUNT_MESSAGES.invalid,
  amountLatinDigits: AMOUNT_MESSAGES.non_latin_digits,
  amountTooManyDecimals: AMOUNT_MESSAGES.too_many_decimals,
  amountNegative: AMOUNT_MESSAGES.negative,
  amountTooLarge: AMOUNT_MESSAGES.too_large,
  dateInvalid: DATE_MESSAGES.invalid,
  dateOutOfRange: DATE_MESSAGES.outOfRange,
  endBeforeStart: "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
  notesTooLong: `ההערות ארוכות מדי (עד ${PROJECT_TEXT_MAX_LENGTH.notes} תווים).`,
} as const;

/** Project and client ids are uuids; anything else cannot name one. */
export const projectIdSchema = z.uuid();

function optionalText(maxLength: number, tooLong: string) {
  return withNormalizedLineBreaks(
    z.string().trim().max(maxLength, { error: tooLong }).transform(emptyToNull),
  );
}

const optionalDate = optionalDateField();

/** Owner decision (M1.2): the contract amount is optional. */
const optionalAmount = optionalAmountField();

export const projectInputSchema = z.object({
  client_id: z
    .string()
    .trim()
    .pipe(z.uuid({ error: PROJECT_FIELD_MESSAGES.clientRequired })),
  name: withNormalizedLineBreaks(
    z
      .string()
      .trim()
      .min(1, { error: PROJECT_FIELD_MESSAGES.nameRequired })
      .max(PROJECT_TEXT_MAX_LENGTH.name, { error: PROJECT_FIELD_MESSAGES.nameTooLong }),
  ),
  property_address: optionalText(
    PROJECT_TEXT_MAX_LENGTH.property_address,
    PROJECT_FIELD_MESSAGES.propertyAddressTooLong,
  ),
  status: z.enum(PROJECT_STATUSES, { error: PROJECT_FIELD_MESSAGES.statusRequired }),
  contract_amount: optionalAmount,
  start_date: optionalDate,
  end_date: optionalDate,
  notes: optionalText(PROJECT_TEXT_MAX_LENGTH.notes, PROJECT_FIELD_MESSAGES.notesTooLong),
});

/** What the user typed, as strings; kept so a failed save never loses input. */
export type ProjectFormValues = Record<ProjectField, string>;

/** A validated project, ready to store (contract_amount in agorot). */
export type ProjectInput = z.output<typeof projectInputSchema>;

export type ProjectFieldErrors = FieldErrors<ProjectField>;

export const EMPTY_PROJECT_FORM_VALUES: ProjectFormValues = {
  client_id: "",
  name: "",
  property_address: "",
  status: "lead",
  contract_amount: "",
  start_date: "",
  end_date: "",
  notes: "",
};

/** Reads the project fields from a submitted form. A missing or non-text field reads as "". */
export function readProjectFormValues(formData: FormData): ProjectFormValues {
  return readFormValues(formData, PROJECT_FIELDS);
}

/** "End date not before start date", checked whenever both dates are valid. */
function datesOrderError({ start_date, end_date }: ProjectFormValues): string | undefined {
  const start = start_date.trim();
  const end = end_date.trim();
  return isIsoDate(start) && isIsoDate(end) && end < start
    ? PROJECT_FIELD_MESSAGES.endBeforeStart
    : undefined;
}

/** Validates form values; on failure returns the first message for each invalid field. */
export function validateProjectInput(
  values: ProjectFormValues,
): ValidationResult<ProjectField, ProjectInput> {
  const result = validateForm(projectInputSchema, PROJECT_FIELDS, values);
  const orderError = datesOrderError(values);
  if (!orderError) {
    return result;
  }
  const fieldErrors = result.success ? {} : result.fieldErrors;
  return { success: false, fieldErrors: { end_date: orderError, ...fieldErrors } };
}

export const PROJECT_SEARCH_QUERY_MAX_LENGTH = 100;
