import { optionalDateField } from "@/lib/field-rules";
import {
  emptyToNull,
  readFormValues,
  validateForm,
  withNormalizedLineBreaks,
  type ValidationResult,
} from "@/lib/forms";
import { z } from "@/lib/zod";

import { DEFAULT_TASK_PRIORITY, TASK_PRIORITIES, TASK_STATUSES } from "./status";

/**
 * The task form schema (TASK-1, TASK-2, TASK-9), shared by the form in the browser and the
 * Server Actions. Required: the title. The due date is optional (TASK-2) and may be in the
 * past (an overdue task is still edited). Client and project are optional; a project needs its
 * client (the form fills it in, the server too, and the database checks they match). The
 * status is on the edit form only; a new task is open. The database repeats these rules.
 */

export const TASK_FIELDS = [
  "title",
  "due_date",
  "priority",
  "client_id",
  "project_id",
  "description",
  "status",
] as const;

export type TaskField = (typeof TASK_FIELDS)[number];

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 2000;

export const TASK_FIELD_MESSAGES = {
  titleRequired: "יש להזין כותרת למשימה.",
  titleTooLong: `הכותרת ארוכה מדי (עד ${TASK_TITLE_MAX_LENGTH} תווים).`,
  descriptionTooLong: `התיאור ארוך מדי (עד ${TASK_DESCRIPTION_MAX_LENGTH} תווים).`,
  priorityRequired: "יש לבחור עדיפות.",
  statusRequired: "יש לבחור סטטוס.",
  clientInvalid: "יש לבחור לקוח מהרשימה.",
  projectInvalid: "יש לבחור פרויקט מהרשימה.",
  projectOfOtherClient: "הפרויקט שייך ללקוח אחר. יש לבחור פרויקט של הלקוח שנבחר.",
} as const;

/** Task ids are uuids; anything else cannot name one. */
export const taskIdSchema = z.uuid();

function optionalId(message: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || z.uuid().safeParse(value).success, { error: message })
    .transform(emptyToNull);
}

export const taskInputSchema = z.object({
  title: withNormalizedLineBreaks(
    z
      .string()
      .trim()
      .min(1, { error: TASK_FIELD_MESSAGES.titleRequired, abort: true })
      .max(TASK_TITLE_MAX_LENGTH, { error: TASK_FIELD_MESSAGES.titleTooLong }),
  ),
  due_date: optionalDateField(),
  priority: z.enum(TASK_PRIORITIES, { error: TASK_FIELD_MESSAGES.priorityRequired }),
  client_id: optionalId(TASK_FIELD_MESSAGES.clientInvalid),
  project_id: optionalId(TASK_FIELD_MESSAGES.projectInvalid),
  description: withNormalizedLineBreaks(
    z
      .string()
      .trim()
      .max(TASK_DESCRIPTION_MAX_LENGTH, { error: TASK_FIELD_MESSAGES.descriptionTooLong })
      .transform(emptyToNull),
  ),
  // "" (the new-task form has no status field): a new task is open.
  status: z
    .union([z.literal(""), z.enum(TASK_STATUSES)], { error: TASK_FIELD_MESSAGES.statusRequired })
    .transform((value) => (value === "" ? "open" : value)),
});

/** What the user typed, as strings; kept so a failed save never loses input. */
export type TaskFormValues = Record<TaskField, string>;

/** A validated task, ready to store. */
export type TaskInput = z.output<typeof taskInputSchema>;

export const EMPTY_TASK_FORM_VALUES: TaskFormValues = {
  title: "",
  due_date: "",
  priority: DEFAULT_TASK_PRIORITY,
  client_id: "",
  project_id: "",
  description: "",
  status: "",
};

/** Reads the task fields from a submitted form. A missing or non-text field reads as "". */
export function readTaskFormValues(formData: FormData): TaskFormValues {
  return readFormValues(formData, TASK_FIELDS);
}

/** Validates form values; on failure returns the first message for each invalid field. */
export function validateTaskInput(values: TaskFormValues): ValidationResult<TaskField, TaskInput> {
  return validateForm(taskInputSchema, TASK_FIELDS, values);
}
