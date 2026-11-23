"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { TextInputField } from "@/components/form-field";
import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";
import {
  EXPORT_PATH,
  FROM_PARAM,
  MAX_EXPORT_YEARS,
  TO_PARAM,
  validateExportRange,
  type ExportKind,
  type ExportRange,
  type ExportRangeField,
} from "@/lib/export/range";

type Errors = Partial<Record<ExportRangeField, string>>;

const FIELDS: readonly ExportRangeField[] = [FROM_PARAM, TO_PARAM];

const DOWNLOADS: readonly { kind: ExportKind; label: string }[] = [
  { kind: "incomes", label: "הורדת קובץ הכנסות" },
  { kind: "expenses", label: "הורדת קובץ הוצאות" },
];

type ExportFormProps = {
  initialValues: ExportRange;
  /** Errors of a range the server sent back (an invalid address). */
  initialErrors: Errors;
  /** The export failed before its first byte. */
  initialFormError: string | null;
};

/**
 * EXPORT-1 / criterion 5: a plain GET form, one submit button per file. The range is checked
 * in the browser first, so a wrong range shows its error next to the field (and focus moves
 * there) instead of starting a download; a valid one is submitted natively and the browser
 * downloads the file while the screen stays. Without JavaScript, or for a hand-made address,
 * the Route Handler checks the range again and sends the user back here with the errors.
 */
export function ExportForm({ initialValues, initialErrors, initialFormError }: ExportFormProps) {
  const [errors, setErrors] = useState<Errors>(initialErrors);
  const [formError, setFormError] = useState(initialFormError);
  const formRef = useRef<HTMLFormElement>(null);

  // Errors sent back by the server: the first invalid field gets focus, as after a check here.
  useEffect(() => {
    const first = FIELDS.find((field) => initialErrors[field]);
    if (first) {
      formRef.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    }
  }, [initialErrors]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const data = new FormData(form);
    const validation = validateExportRange(data.get(FROM_PARAM), data.get(TO_PARAM));
    // A partly typed date submits "" (validity.badInput): say it is invalid, not missing.
    const nextErrors: Errors = validation.ok
      ? checkDateInputs(form, FIELDS)
      : { ...validation.errors, ...checkDateInputs(form, FIELDS) };
    setFormError(null);
    setErrors(nextErrors);
    const first = FIELDS.find((field) => nextErrors[field]);
    if (first) {
      event.preventDefault();
      form.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
    }
  }

  return (
    <form
      ref={formRef}
      method="get"
      action={`${EXPORT_PATH}/incomes`}
      noValidate
      onSubmit={handleSubmit}
      aria-label="טווח הייצוא"
      className="max-w-xl space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInputField
          name={FROM_PARAM}
          label="מתאריך"
          type="date"
          min={MIN_ISO_DATE}
          max={MAX_ISO_DATE}
          defaultValue={initialValues.from}
          error={errors.from}
        />
        <TextInputField
          name={TO_PARAM}
          label="עד תאריך (כולל)"
          type="date"
          min={MIN_ISO_DATE}
          max={MAX_ISO_DATE}
          defaultValue={initialValues.to}
          error={errors.to}
        />
      </div>
      {formError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {DOWNLOADS.map(({ kind, label }) => (
          <button
            key={kind}
            type="submit"
            formAction={`${EXPORT_PATH}/${kind}`}
            className={buttonClasses("secondary")}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        הקובץ נשמר בתיקיית ההורדות של המכשיר. אפשר לייצא עד {MAX_EXPORT_YEARS} שנים בכל קובץ.
      </p>
    </form>
  );
}
