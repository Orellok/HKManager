"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";

import { callServerAction } from "@/lib/auth/action-failure";
import {
  firstInvalidField,
  type FieldErrors,
  type ServerFormState,
  type ValidationResult,
} from "@/lib/forms";

import { useGuardedTransition } from "./use-guarded-transition";

export const FIX_FIELDS_MESSAGE = "לא ניתן לשמור. יש לתקן את השדות המסומנים.";
export const SAVE_UNAVAILABLE_MESSAGE = "לא ניתן לשמור כרגע. בדקו את החיבור ונסו שוב.";

type UseServerFormOptions<Field extends string> = {
  action: (state: ServerFormState<Field>, formData: FormData) => Promise<ServerFormState<Field>>;
  initialValues: Record<Field, string>;
  /** The form's fields in display order (focus goes to the first invalid one). */
  fields: readonly Field[];
  read: (formData: FormData) => Record<Field, string>;
  validate: (values: Record<Field, string>) => ValidationResult<Field, unknown>;
};

function focusField(form: HTMLFormElement | null, field: string | undefined) {
  if (form && field) {
    form.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }
}

/**
 * A create/edit form that saves through a Server Action. Validated with the shared schema
 * in the browser before sending and again by the action. Errors appear next to their field,
 * focus moves to the first invalid field, and what the user typed is kept, also when the
 * request itself fails (no connection, server error). An ended session goes to /login.
 * Duplicate submits are turned away while a save is running.
 */
export function useServerForm<Field extends string>({
  action,
  initialValues,
  fields,
  read,
  validate,
}: UseServerFormOptions<Field>) {
  // Without JavaScript (or before hydration) the form posts to the Server Action itself and
  // this state holds its answer. With JavaScript, handleSubmit validates in the browser and
  // calls the action directly, so a failed request can be caught and the input kept.
  const [serverState, formAction] = useActionState(action, {
    values: initialValues,
    fieldErrors: {},
    formError: null,
  });
  const [browserState, setBrowserState] = useState<ServerFormState<Field> | null>(null);
  const [browserErrors, setBrowserErrors] = useState<FieldErrors<Field> | null>(null);
  const [pending, startSave] = useGuardedTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const state = browserState ?? serverState;
  const errors = browserErrors ?? state.fieldErrors;
  const formMessage =
    state.formError ?? (firstInvalidField(fields, errors) ? FIX_FIELDS_MESSAGE : null);

  // After the server answered with errors, move focus to the first invalid field.
  useEffect(() => {
    focusField(formRef.current, firstInvalidField(fields, state.fieldErrors));
  }, [state, fields]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // With JavaScript the save always runs here; the form action is the no-JavaScript path.
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const values = read(formData);
    if (pending) {
      return;
    }
    const validation = validate(values);
    if (!validation.success) {
      setBrowserErrors(validation.fieldErrors);
      focusField(form, firstInvalidField(fields, validation.fieldErrors));
      return;
    }
    startSave(async () => {
      setBrowserErrors(null);
      // On success the action redirects; it returns only with errors.
      const result = await callServerAction(() => action(state, formData));
      if (result.status === "done") {
        setBrowserState(result.value);
      } else if (result.status === "failed") {
        // Nothing was saved. The fields were never reset, so the input is still in the form.
        setBrowserState({ values, fieldErrors: {}, formError: SAVE_UNAVAILABLE_MESSAGE });
      }
    });
  }

  return { formRef, formAction, handleSubmit, values: state.values, errors, formMessage, pending };
}
