import { requiredAmountField, requiredDateField } from "@/lib/field-rules";
import {
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type FieldErrors,
  type ValidationResult,
} from "@/lib/forms";
import { z } from "@/lib/zod";

/**
 * The milestone form schema (MS-1), shared by the form in the browser and the Server Actions.
 * Required: description, amount, due date. The amount is typed in shekels and stored in
 * agorot (0 is allowed). The database repeats these rules as check constraints.
 */

export const MILESTONE_FIELDS = ["description", "amount", "due_date"] as const;

export type MilestoneField = (typeof MILESTONE_FIELDS)[number];

export const MILESTONE_DESCRIPTION_MAX_LENGTH = 200;

export const MILESTONE_FIELD_MESSAGES = {
  descriptionRequired: "יש להזין תיאור.",
  descriptionTooLong: `התיאור ארוך מדי (עד ${MILESTONE_DESCRIPTION_MAX_LENGTH} תווים).`,
  amountRequired: "יש להזין סכום.",
  dueDateRequired: "יש להזין תאריך יעד.",
} as const;

/** Milestone ids are uuids; anything else cannot name one. */
export const milestoneIdSchema = z.uuid();

export const milestoneInputSchema = z.object({
  description: withNormalizedLineBreaks(
    z
      .string()
      .trim()
      .min(1, { error: MILESTONE_FIELD_MESSAGES.descriptionRequired })
      .max(MILESTONE_DESCRIPTION_MAX_LENGTH, {
        error: MILESTONE_FIELD_MESSAGES.descriptionTooLong,
      }),
  ),
  amount: requiredAmountField(MILESTONE_FIELD_MESSAGES.amountRequired),
  due_date: requiredDateField(MILESTONE_FIELD_MESSAGES.dueDateRequired),
});

/** What the user typed, as strings; kept so a failed save never loses input. */
export type MilestoneFormValues = Record<MilestoneField, string>;

/** A validated milestone, ready to store (amount in agorot). */
export type MilestoneInput = z.output<typeof milestoneInputSchema>;

export type MilestoneFieldErrors = FieldErrors<MilestoneField>;

export const EMPTY_MILESTONE_FORM_VALUES: MilestoneFormValues = {
  description: "",
  amount: "",
  due_date: "",
};

/** Reads the milestone fields from a submitted form. A missing or non-text field reads as "". */
export function readMilestoneFormValues(formData: FormData): MilestoneFormValues {
  return readFormValues(formData, MILESTONE_FIELDS);
}

/** Validates form values; on failure returns the first message for each invalid field. */
export function validateMilestoneInput(
  values: MilestoneFormValues,
): ValidationResult<MilestoneField, MilestoneInput> {
  return validateForm(milestoneInputSchema, MILESTONE_FIELDS, values);
}
