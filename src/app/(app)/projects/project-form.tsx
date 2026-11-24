"use client";

import Link from "next/link";

import { CreateKeyInput } from "@/components/create-key-input";
import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { SelectField, TextInputField, TextareaField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import type { ProjectFormState } from "@/lib/projects/actions";
import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";
import { CLIENT_OPTIONS_LIMIT, type ClientOption } from "@/lib/projects/queries";
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
  /** More active clients exist than `clientOptions` holds (CLIENT_OPTIONS_LIMIT). */
  moreClientsExist: boolean;
  /** M7.1-8: the key of a create form (null when editing). */
  createKey?: string | null;
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";
const DATE_FIELDS = ["start_date", "end_date"] as const;

function checkProjectDateInputs(form: HTMLFormElement) {
  return checkDateInputs(form, DATE_FIELDS);
}

const MORE_CLIENTS_HINT = `מוצגים ${CLIENT_OPTIONS_LIMIT} הלקוחות הפעילים הראשונים לפי שם. ללקוח אחר אפשר לפתוח פרויקט מכרטיס הלקוח.`;

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
  moreClientsExist,
  createKey = null,
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
      checkControls: checkProjectDateInputs,
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
      <CreateKeyInput value={createKey} />
      <p role="alert" className="text-destructive text-sm font-medium">
        {formMessage}
      </p>

      <SelectField
        name="client_id"
        label="לקוח"
        requiredMark={REQUIRED}
        placeholder="בחירת לקוח"
        hint={moreClientsExist ? MORE_CLIENTS_HINT : undefined}
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
          min={MIN_ISO_DATE}
          max={MAX_ISO_DATE}
          defaultValue={values.start_date}
          error={errors.start_date}
        />
        <TextInputField
          name="end_date"
          label="תאריך סיום"
          type="date"
          min={MIN_ISO_DATE}
          max={MAX_ISO_DATE}
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
