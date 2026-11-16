"use client";

import Link from "next/link";

import { Button, buttonClasses } from "@/components/button";
import { SelectField, TextInputField, TextareaField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import type { ProjectFormState } from "@/lib/projects/actions";
import type { ClientOption } from "@/lib/projects/queries";
import {
  PROJECT_FIELDS,
  readProjectFormValues,
  validateProjectInput,
  type ProjectFormValues,
} from "@/lib/projects/schema";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/projects/status";

type ProjectFormProps = {
  action: (state: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;
  initialValues: ProjectFormValues;
  /** The clients to choose from: active ones, plus the current client when it is archived. */
  clientOptions: readonly ClientOption[];
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";

const STATUS_OPTIONS = PROJECT_STATUSES.map((status) => ({
  value: status,
  label: PROJECT_STATUS_LABELS[status],
}));

/**
 * PRJ-1 / PRJ-2: create and edit form (saving, validation, errors and failed requests: see
 * useServerForm). The amount is typed in shekels and stored in agorot; dates use the native
 * date input.
 */
export function ProjectForm({
  action,
  initialValues,
  clientOptions,
  submitLabel,
  cancelHref,
}: ProjectFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: PROJECT_FIELDS,
      read: readProjectFormValues,
      validate: validateProjectInput,
    },
  );

  const options = clientOptions.map((client) => ({
    value: client.id,
    label: client.archived ? `${client.name} (בארכיון)` : client.name,
  }));

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

      <SelectField
        name="client_id"
        label="לקוח"
        requiredMark={REQUIRED}
        placeholder="בחירת לקוח"
        options={options}
        defaultValue={values.client_id}
        error={errors.client_id}
      />
      <TextInputField
        name="name"
        label="שם הפרויקט"
        requiredMark={REQUIRED}
        autoComplete="off"
        defaultValue={values.name}
        error={errors.name}
      />
      <TextInputField
        name="property_address"
        label="כתובת הנכס"
        autoComplete="off"
        defaultValue={values.property_address}
        error={errors.property_address}
      />
      <SelectField
        name="status"
        label="סטטוס"
        requiredMark={REQUIRED}
        options={STATUS_OPTIONS}
        defaultValue={values.status}
        error={errors.status}
      />
      <TextInputField
        name="contract_amount"
        label="סכום חוזה (₪)"
        hint="בשקלים, למשל 12,500 או 12,500.50. אפשר להשאיר ריק."
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.contract_amount}
        error={errors.contract_amount}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextInputField
          name="start_date"
          label="תאריך התחלה"
          type="date"
          defaultValue={values.start_date}
          error={errors.start_date}
        />
        <TextInputField
          name="end_date"
          label="תאריך סיום"
          type="date"
          defaultValue={values.end_date}
          error={errors.end_date}
        />
      </div>
      <TextareaField name="notes" label="הערות" defaultValue={values.notes} error={errors.notes} />

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
