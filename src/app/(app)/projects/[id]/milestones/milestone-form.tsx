"use client";

import Link from "next/link";

import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { TextInputField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";
import type { MilestoneFormState } from "@/lib/milestones/actions";
import {
  MILESTONE_DESCRIPTION_MAX_LENGTH,
  MILESTONE_FIELDS,
  readMilestoneFormValues,
  validateMilestoneInput,
  type MilestoneFormValues,
} from "@/lib/milestones/schema";

type MilestoneFormProps = {
  action: (state: MilestoneFormState, formData: FormData) => Promise<MilestoneFormState>;
  initialValues: MilestoneFormValues;
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";
const DATE_FIELDS = ["due_date"] as const;

function checkDueDateInput(form: HTMLFormElement) {
  return checkDateInputs(form, DATE_FIELDS);
}

/**
 * MS-1: add and edit form for a milestone (saving, validation, errors and failed requests:
 * see useServerForm). The amount is typed in shekels and stored in agorot.
 */
export function MilestoneForm({
  action,
  initialValues,
  submitLabel,
  cancelHref,
}: MilestoneFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: MILESTONE_FIELDS,
      read: readMilestoneFormValues,
      validate: validateMilestoneInput,
      checkControls: checkDueDateInput,
    },
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="max-w-xl space-y-5"
    >
      <p role="alert" className="text-destructive text-sm font-medium">
        {formMessage}
      </p>

      <TextInputField
        name="description"
        label="תיאור"
        requiredMark={REQUIRED}
        hint="למשל: מקדמה, סיום שלב התכנון."
        autoComplete="off"
        maxLength={MILESTONE_DESCRIPTION_MAX_LENGTH}
        defaultValue={values.description}
        error={errors.description}
      />
      <TextInputField
        name="amount"
        label="סכום (₪)"
        requiredMark={REQUIRED}
        hint="בשקלים, למשל 12,500 או 12,500.50."
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.amount}
        error={errors.amount}
      />
      <TextInputField
        name="due_date"
        label="תאריך יעד"
        requiredMark={REQUIRED}
        type="date"
        min={MIN_ISO_DATE}
        max={MAX_ISO_DATE}
        defaultValue={values.due_date}
        error={errors.due_date}
      />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending}>
          {pending ? "שומר…" : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses("secondary")}>
          ביטול
        </Link>
      </div>
    </form>
  );
}
