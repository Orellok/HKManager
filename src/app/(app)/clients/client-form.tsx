"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button, buttonClasses } from "@/components/button";
import { CreateKeyInput } from "@/components/create-key-input";
import { TextInputField, TextareaField } from "@/components/form-field";
import { useServerForm } from "@/components/use-server-form";
import {
  findDuplicateClientsAction,
  type ClientFormState,
  type DuplicateClientsResult,
} from "@/lib/clients/actions";
import { duplicateNameKey, isSameClientName } from "@/lib/clients/duplicate-name";
import type { DuplicateClient } from "@/lib/clients/queries";
import {
  CLIENT_FIELDS,
  readClientFormValues,
  validateClientInput,
  type ClientFormValues,
} from "@/lib/clients/schema";

type ClientFormProps = {
  action: (state: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initialValues: ClientFormValues;
  /** The client being edited (excluded from the duplicate check), or null for a new one. */
  clientId: string | null;
  /** M7.1-8: the key of a create form (null when editing). */
  createKey?: string | null;
  submitLabel: string;
  cancelHref: string;
};

const DUPLICATE_WARNING_ID = "name-duplicate-warning";

function duplicateWarningText(duplicates: DuplicateClient[]): string {
  const allArchived = duplicates.every((client) => client.archived_at !== null);
  return allArchived
    ? "שימו לב: בארכיון כבר יש לקוח בשם הזה. אפשר לשמור בכל זאת."
    : "שימו לב: כבר קיים לקוח בשם הזה. אפשר לשמור בכל זאת.";
}

/**
 * CLI-1: create and edit form (saving, validation, errors and failed requests: see
 * useServerForm), with the duplicate-name warning (owner decision: warn, never block).
 */
export function ClientForm({
  action,
  initialValues,
  clientId,
  createKey = null,
  submitLabel,
  cancelHref,
}: ClientFormProps) {
  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: CLIENT_FIELDS,
      read: readClientFormValues,
      validate: validateClientInput,
    },
  );
  const [duplicates, setDuplicates] = useState<DuplicateClient[]>([]);
  const [, startDuplicateCheck] = useTransition();
  const lastCheckedKey = useRef<string | null>(null);

  function checkDuplicateName(name: string) {
    const key = duplicateNameKey(name);
    const unchangedName = clientId !== null && isSameClientName(name, initialValues.name);
    if (key === "" || unchangedName) {
      lastCheckedKey.current = null;
      setDuplicates([]);
      return;
    }
    if (key === lastCheckedKey.current) {
      return;
    }
    lastCheckedKey.current = key;
    startDuplicateCheck(async () => {
      let result: DuplicateClientsResult;
      try {
        result = await findDuplicateClientsAction({ name, excludeId: clientId });
      } catch (error) {
        unstable_rethrow(error);
        // The request failed. The warning is advisory, and the card shows it after saving;
        // an ended session is caught when the user saves.
        result = { ok: false };
      }
      // A later check replaced this one, or the lookup failed: the warning is advisory only.
      if (lastCheckedKey.current !== key || !result.ok) {
        if (lastCheckedKey.current === key) {
          lastCheckedKey.current = null;
        }
        return;
      }
      setDuplicates(result.clients);
    });
  }

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

      <div className="space-y-2">
        <TextInputField
          name="name"
          label="שם"
          requiredMark="(חובה)"
          defaultValue={values.name}
          error={errors.name}
          describedBy={duplicates.length > 0 ? DUPLICATE_WARNING_ID : undefined}
          autoComplete="off"
          onBlur={(event) => checkDuplicateName(event.currentTarget.value)}
          onChange={() => {
            if (duplicates.length > 0) {
              lastCheckedKey.current = null;
              setDuplicates([]);
            }
          }}
        />
        <div aria-live="polite">
          {duplicates.length > 0 ? (
            <p id={DUPLICATE_WARNING_ID} className="bg-muted rounded-md border p-3 text-sm">
              {duplicateWarningText(duplicates)}
            </p>
          ) : null}
        </div>
      </div>

      <TextInputField
        name="phone"
        label="טלפון"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.phone}
        error={errors.phone}
      />
      <TextInputField
        name="email"
        label="מייל"
        type="email"
        inputMode="email"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.email}
        error={errors.email}
      />
      <TextInputField
        name="address"
        label="כתובת"
        autoComplete="off"
        defaultValue={values.address}
        error={errors.address}
      />
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
