import { readFormValues, validateForm, type ValidationResult } from "@/lib/forms";
import { z } from "@/lib/zod";

/**
 * The expense category form (EXP-3, owner decision M3: add and rename), shared by the form
 * in the browser and the Server Actions. The database repeats the rules (check constraint
 * and a unique name).
 */

export const CATEGORY_FIELDS = ["name"] as const;

export type CategoryField = (typeof CATEGORY_FIELDS)[number];

export const CATEGORY_NAME_MAX_LENGTH = 50;

export const CATEGORY_FIELD_MESSAGES = {
  nameRequired: "יש להזין שם לקטגוריה.",
  nameTooLong: `השם ארוך מדי (עד ${CATEGORY_NAME_MAX_LENGTH} תווים).`,
  nameTaken: "כבר יש קטגוריה בשם הזה (אולי בארכיון). יש לבחור שם אחר.",
} as const;

/** Category ids are uuids; anything else cannot name one. */
export const categoryIdSchema = z.uuid();

export const categoryInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: CATEGORY_FIELD_MESSAGES.nameRequired, abort: true })
    .max(CATEGORY_NAME_MAX_LENGTH, { error: CATEGORY_FIELD_MESSAGES.nameTooLong }),
});

export type CategoryFormValues = Record<CategoryField, string>;

export type CategoryInput = z.output<typeof categoryInputSchema>;

export function readCategoryFormValues(formData: FormData): CategoryFormValues {
  return readFormValues(formData, CATEGORY_FIELDS);
}

export function validateCategoryInput(
  values: CategoryFormValues,
): ValidationResult<CategoryField, CategoryInput> {
  return validateForm(categoryInputSchema, CATEGORY_FIELDS, values);
}
