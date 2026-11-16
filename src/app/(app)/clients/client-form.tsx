"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { TextInputField, TextareaField } from "@/components/form-field";
import { redirectToLoginIfSessionEnded } from "@/lib/auth/action-failure";
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
  type ClientField,
  type ClientFieldErrors,
  type ClientFormValues,
} from "@/lib/clients/schema";

type ClientFormProps = {
  action: (state: ClientFormState, formData: FormData) => Promise<ClientFormState>;
  initialValues: ClientFormValues;
  /** The client being edited (excluded from the duplicate check), or null for a new one. */
  clientId: string | null;
  submitLabel: string;
  cancelHref: string;
};

const DUPLICATE_WARNING_ID = "name-duplicate-warning";
const FIX_FIELDS_MESSAGE = "לא ניתן לשמור. יש לתקן את השדות המסומנים.";
const SAVE_UNAVAILABLE_MESSAGE = "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.";

function firstInvalidField(errors: ClientFieldErrors): ClientField | undefined {
  return CLIENT_FIELDS.find((field) => errors[field]);
}

function focusField(form: HTMLFormElement | null, field: ClientField | undefined) {
  if (form && field) {
    form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }
}

function duplicateWarningText(duplicates: DuplicateClient[]): string {
  const allArchived = duplicates.every((client) => client.archived_at !== null);
  return allArchived
    ? "שימו לב: בארכיון כבר יש לקוח בשם הזה. אפשר לשמור בכל זאת."
    : "שימו לב: כבר קיים לקוח בשם הזה. אפשר לשמור בכל זאת.";
}

/**
 * CLI-1: create and edit form. Validated with the shared schema in the browser before
 * sending and again by the Server Action. Errors appear next to their field, focus moves to
 * the first invalid field, and what the user typed is kept.
 */
export function ClientForm({
  action,
  initialValues,
  clientId,
  submitLabel,
  cancelHref,
}: ClientFormProps) {
  // Without JavaScript (or before hydration) the form posts to the Server Action itself and
  // this state holds its answer. With JavaScript, handleSubmit validates in the browser and
  // calls the action directly, so a failed request can be caught and the input kept.
  const [serverState, formAction] = useActionState(action, {
    values: initialValues,
    fieldErrors: {},
    formError: null,
  });
  const [browserState, setBrowserState] = useState<ClientFormState | null>(null);
  const [pending, startSave] = useTransition();
  const [browserErrors, setBrowserErrors] = useState<ClientFieldErrors | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateClient[]>([]);
  const [, startDuplicateCheck] = useTransition();
  const lastCheckedKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const state = browserState ?? serverState;
  const errors = browserErrors ?? state.fieldErrors;
  const hasErrors = firstInvalidField(errors) !== undefined;

  // After the server answered with errors, move focus to the first invalid field.
  useEffect(() => {
    focusField(formRef.current, firstInvalidField(state.fieldErrors));
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // With JavaScript the save always runs here; the form action is the no-JavaScript path.
    event.preventDefault();
    if (pending) {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const values = readClientFormValues(formData);
    const validation = validateClientInput(values);
    if (!validation.success) {
      setBrowserErrors(validation.fieldErrors);
      focusField(event.currentTarget, firstInvalidField(validation.fieldErrors));
      return;
    }
    setBrowserErrors(null);
    startSave(async () => {
      try {
        // On success the action redirects to the card; it returns only with errors.
        setBrowserState(await action(state, formData));
      } catch (error) {
        unstable_rethrow(error);
        if (await redirectToLoginIfSessionEnded()) {
          return;
        }
        // The request failed (no connection, server error): nothing was saved. The fields
        // were never reset, so everything the user typed is still in the form.
        setBrowserState({ values, fieldErrors: {}, formError: SAVE_UNAVAILABLE_MESSAGE });
      }
    });
  }

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

  const values = state.values;

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="max-w-xl space-y-5"
    >
      <p role="alert" className="text-destructive text-sm font-medium">
        {state.formError ?? (hasErrors ? FIX_FIELDS_MESSAGE : null)}
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
