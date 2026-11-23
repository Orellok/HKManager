"use client";

import Link from "next/link";

import { Button, buttonClasses } from "@/components/button";
import { TextInputField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import type { CeilingFormState } from "@/lib/ceiling/actions";
import {
  CEILING_FIELDS,
  readCeilingFormValues,
  validateCeilingInput,
  type CeilingFormValues,
} from "@/lib/ceiling/schema";
import { SETTINGS_PATH } from "@/lib/expense-categories/paths";

type CeilingFormProps = {
  action: (state: CeilingFormState, formData: FormData) => Promise<CeilingFormState>;
  initialValues: CeilingFormValues;
  /** The edit form: the year is fixed (shown, not editable). */
  fixedYear: number | null;
  submitLabel: string;
};

/**
 * CEIL-1 (admin only): adds the ceiling of a tax year, or changes one (saving, validation,
 * errors and failed requests: see useServerForm).
 */
export function CeilingForm({ action, initialValues, fixedYear, submitLabel }: CeilingFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: CEILING_FIELDS,
      read: readCeilingFormValues,
      validate: validateCeilingInput,
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
      {fixedYear === null ? (
        <TextInputField
          name="year"
          label="שנת מס"
          requiredMark="(חובה)"
          hint="שנה קלנדרית, למשל 2027."
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          dir="ltr"
          className="text-end"
          defaultValue={values.year}
          error={errors.year}
        />
      ) : (
        <input type="hidden" name="year" value={String(fixedYear)} />
      )}
      <TextInputField
        name="exempt_ceiling"
        label="תקרת המחזור (₪)"
        requiredMark="(חובה)"
        hint="בשקלים, למשל 122,833."
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.exempt_ceiling}
        error={errors.exempt_ceiling}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending}>
          {pending ? "שומר…" : submitLabel}
        </Button>
        <Link href={SETTINGS_PATH} className={buttonClasses("secondary")}>
          ביטול
        </Link>
      </div>
    </form>
  );
}
