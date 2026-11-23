import { requiredAmountField } from "@/lib/field-rules";
import { readFormValues, validateForm, type ValidationResult } from "@/lib/forms";
import { MAX_YEAR, MIN_YEAR } from "@/lib/dashboard/period";
import { z } from "@/lib/zod";

/**
 * The yearly ceiling form (CEIL-1, admin only), shared by the form in the browser and the
 * Server Actions. The year is a calendar tax year (DASH-6); the ceiling is typed in shekels
 * and stored as integer agorot. The database repeats these rules.
 */

export const CEILING_FIELDS = ["year", "exempt_ceiling"] as const;

export type CeilingField = (typeof CEILING_FIELDS)[number];

export const CEILING_FIELD_MESSAGES = {
  yearRequired: "יש להזין שנה.",
  yearInvalid: `יש להזין שנה בת 4 ספרות, בין ${MIN_YEAR} ל-${MAX_YEAR}.`,
  yearTaken: "כבר הוגדרה תקרה לשנה הזו. אפשר לעדכן אותה מרשימת התקרות.",
  ceilingRequired: "יש להזין את התקרה.",
  ceilingNotPositive: "התקרה חייבת להיות גדולה מ-0.",
} as const;

/** A year in the URL or a form: four digits within the app's range. */
export const yearSchema = z
  .string()
  .trim()
  .min(1, { error: CEILING_FIELD_MESSAGES.yearRequired, abort: true })
  .regex(/^\d{4}$/, { error: CEILING_FIELD_MESSAGES.yearInvalid, abort: true })
  .transform(Number)
  .refine((year) => year >= MIN_YEAR && year <= MAX_YEAR, {
    error: CEILING_FIELD_MESSAGES.yearInvalid,
  });

export const ceilingInputSchema = z.object({
  year: yearSchema,
  exempt_ceiling: requiredAmountField(CEILING_FIELD_MESSAGES.ceilingRequired).refine(
    (agorot) => agorot > 0,
    { error: CEILING_FIELD_MESSAGES.ceilingNotPositive },
  ),
});

export type CeilingFormValues = Record<CeilingField, string>;

export type CeilingInput = z.output<typeof ceilingInputSchema>;

export function readCeilingFormValues(formData: FormData): CeilingFormValues {
  return readFormValues(formData, CEILING_FIELDS);
}

export function validateCeilingInput(
  values: CeilingFormValues,
): ValidationResult<CeilingField, CeilingInput> {
  return validateForm(ceilingInputSchema, CEILING_FIELDS, values);
}
