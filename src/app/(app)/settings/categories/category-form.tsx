"use client";

import Link from "next/link";

import { Button, buttonClasses } from "@/components/button";
import { TextInputField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import type { CategoryFormState } from "@/lib/expense-categories/actions";
import { SETTINGS_PATH } from "@/lib/expense-categories/paths";
import {
  CATEGORY_FIELDS,
  CATEGORY_NAME_MAX_LENGTH,
  readCategoryFormValues,
  validateCategoryInput,
  type CategoryFormValues,
} from "@/lib/expense-categories/schema";

type CategoryFormProps = {
  action: (state: CategoryFormState, formData: FormData) => Promise<CategoryFormState>;
  initialValues: CategoryFormValues;
  submitLabel: string;
};

/**
 * EXP-3: adds a category or renames one (saving, validation, errors and failed requests: see
 * useServerForm). Enter in the name field saves.
 */
export function CategoryForm({ action, initialValues, submitLabel }: CategoryFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: CATEGORY_FIELDS,
      read: readCategoryFormValues,
      validate: validateCategoryInput,
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
        name="name"
        label="שם הקטגוריה"
        requiredMark="(חובה)"
        autoComplete="off"
        maxLength={CATEGORY_NAME_MAX_LENGTH}
        defaultValue={values.name}
        error={errors.name}
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
