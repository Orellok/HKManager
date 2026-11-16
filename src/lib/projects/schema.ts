import { isIsoDate, isIsoDateInRange } from "@/lib/dates";
import {
  emptyToNull,
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type FieldErrors,
  type ValidationResult,
} from "@/lib/forms";
import { MAX_AGOROT, formatAgorot, parseShekelsToAgorot, type ShekelParseError } from "@/lib/money";
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
  amountInvalid: "יש להזין סכום בספרות, למשל 12,500 או 12,500.50.",
  amountTooManyDecimals: "אפשר להזין עד שתי ספרות אחרי הנקודה (אגורות).",
  amountNegative: "הסכום לא יכול להיות שלילי.",
  amountTooLarge: `הסכום גדול מדי (עד ${formatAgorot(MAX_AGOROT)}).`,
  dateInvalid: "יש להזין תאריך תקין.",
  endBeforeStart: "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
  notesTooLong: `ההערות ארוכות מדי (עד ${PROJECT_TEXT_MAX_LENGTH.notes} תווים).`,
} as const;

const AMOUNT_MESSAGES: Record<ShekelParseError, string> = {
  invalid: PROJECT_FIELD_MESSAGES.amountInvalid,
  too_many_decimals: PROJECT_FIELD_MESSAGES.amountTooManyDecimals,
  negative: PROJECT_FIELD_MESSAGES.amountNegative,
  too_large: PROJECT_FIELD_MESSAGES.amountTooLarge,
};

/** Project and client ids are uuids; anything else cannot name one. */
export const projectIdSchema = z.uuid();

function optionalText(maxLength: number, tooLong: string) {
  return withNormalizedLineBreaks(
    z.string().trim().max(maxLength, { error: tooLong }).transform(emptyToNull),
  );
}

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || (isIsoDate(value) && isIsoDateInRange(value)), {
    error: PROJECT_FIELD_MESSAGES.dateInvalid,
  })
  .transform(emptyToNull);

/** Shekels as typed → integer agorot, or null when empty (owner decision: optional). */
const optionalAmount = z
  .string()
  .trim()
  .transform((value, context): number | null => {
    if (value === "") {
      return null;
    }
    const parsed = parseShekelsToAgorot(value);
    if (!parsed.ok) {
      context.addIssue({ code: "custom", message: AMOUNT_MESSAGES[parsed.error] });
      return z.NEVER;
    }
    return parsed.agorot;
  });

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
