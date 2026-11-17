"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { TextInputField } from "@/components/form-field";
import { useHydrated } from "@/components/use-hydrated";
import {
  SAVE_UNAVAILABLE_MESSAGE,
  useServerForm,
  type BeforeSaveResult,
} from "@/components/use-server-form";
import { callServerAction } from "@/lib/auth/action-failure";
import { MIN_ISO_DATE, todayInJerusalem } from "@/lib/dates";
import { prepareReceiptUploadAction, type ReceiptFormState } from "@/lib/documents/actions";
import {
  PDF_MIME_TYPE,
  RECEIPTS_BUCKET,
  RECEIPT_FILE_MESSAGES,
  checkReceiptFile,
  checkReceiptFileContent,
} from "@/lib/documents/file";
import {
  DOC_NUMBER_MAX_LENGTH,
  FILE_PATH_FIELD,
  RECEIPT_FIELDS,
  RECEIPT_URL_MAX_LENGTH,
  readReceiptFormValues,
  validateReceiptInput,
  type ReceiptField,
  type ReceiptFormValues,
  type ReceiptSource,
} from "@/lib/documents/schema";
import type { FieldErrors } from "@/lib/forms";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type ReceiptFormProps = {
  action: (state: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;
  incomeId: string;
  initialValues: ReceiptFormValues;
  /** Editing a receipt whose file is stored: leaving the file input empty keeps it. */
  hasStoredFile: boolean;
  /** Today in Asia/Jerusalem, from the server: the latest issue date the input offers. */
  today: string;
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";
const DATE_FIELDS = ["issued_date"] as const;
const UPLOAD_FAILED = "העלאת הקובץ נכשלה. בדקו את החיבור ונסו שוב.";
const SOURCE_LABELS: Record<ReceiptSource, string> = {
  file: "קובץ PDF",
  link: "קישור לקבלה",
};
const SOURCE_ERROR_ID = "field-source-error";

function validateForToday(values: ReceiptFormValues) {
  return validateReceiptInput(values, todayInJerusalem());
}

/** The PDF chosen in the form, if any. */
function chosenFile(form: HTMLFormElement): File | undefined {
  const input = form.elements.namedItem("file");
  return input instanceof HTMLInputElement ? (input.files?.[0] ?? undefined) : undefined;
}

/**
 * DOC-2 / DOC-3 and the owner decision on editing: records the receipt issued at the
 * provider (number, issue date, and a PDF or an https link), or changes the details of the
 * recorded one. Saving, validation, errors and failed requests: see useServerForm.
 *
 * A PDF never travels in the form data. After validation the browser checks it (size, type,
 * "%PDF-" signature), gets a signed upload URL from the server, uploads it straight to the
 * private bucket, and saves with the stored path; the server checks the stored file again.
 */
export function ReceiptForm({
  action,
  incomeId,
  initialValues,
  hasStoredFile,
  today,
  submitLabel,
  cancelHref,
}: ReceiptFormProps) {
  const [source, setSource] = useState(initialValues.source);
  // The file and link inputs follow the choice through JavaScript; a choice made before
  // hydration would not show the matching input, so the choice waits for hydration.
  const hydrated = useHydrated();

  function checkControls(form: HTMLFormElement): FieldErrors<ReceiptField> {
    const errors: FieldErrors<ReceiptField> = checkDateInputs(form, DATE_FIELDS);
    const selectedSource = new FormData(form).get("source");
    if (selectedSource !== "file") {
      return errors;
    }
    const file = chosenFile(form);
    if (!file) {
      if (!hasStoredFile) {
        errors.file = RECEIPT_FILE_MESSAGES.required;
      }
      return errors;
    }
    const problem = checkReceiptFile(file);
    if (problem) {
      errors.file = RECEIPT_FILE_MESSAGES[problem];
    }
    return errors;
  }

  async function uploadChosenFile(formData: FormData): Promise<BeforeSaveResult<ReceiptField>> {
    // The file goes to Storage, never to the Server Action.
    formData.delete("file");
    formData.delete(FILE_PATH_FIELD);
    const file = formRef.current ? chosenFile(formRef.current) : undefined;
    if (formData.get("source") !== "file" || !file) {
      return { status: "ready" };
    }
    const problem = await checkReceiptFileContent(file);
    if (problem) {
      return { status: "rejected", fieldErrors: { file: RECEIPT_FILE_MESSAGES[problem] } };
    }
    const call = await callServerAction(() =>
      prepareReceiptUploadAction(incomeId, { size: file.size, type: file.type }),
    );
    if (call.status === "redirected") {
      return { status: "redirected" };
    }
    if (call.status === "failed") {
      return { status: "rejected", formError: SAVE_UNAVAILABLE_MESSAGE };
    }
    if (!call.value.ok) {
      return {
        status: "rejected",
        fieldErrors: call.value.fieldError ? { file: call.value.fieldError } : {},
        formError: call.value.formError,
      };
    }
    const { path, token } = call.value;
    try {
      const { error } = await createSupabaseBrowserClient()
        .storage.from(RECEIPTS_BUCKET)
        // Sent with the PDF type it was checked for, whatever type the system gave the file.
        .uploadToSignedUrl(path, token, new Blob([file], { type: PDF_MIME_TYPE }));
      if (error) {
        return { status: "rejected", formError: UPLOAD_FAILED };
      }
    } catch {
      return { status: "rejected", formError: UPLOAD_FAILED };
    }
    formData.set(FILE_PATH_FIELD, path);
    return { status: "ready" };
  }

  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: RECEIPT_FIELDS,
      read: readReceiptFormValues,
      validate: validateForToday,
      checkControls,
      beforeSave: uploadChosenFile,
    },
  );

  function changeSource(event: ChangeEvent<HTMLInputElement>) {
    setSource(event.currentTarget.value);
  }

  const fileHint = hasStoredFile
    ? "PDF בלבד, עד 10MB. אפשר להשאיר ריק כדי לשמור את הקובץ הנוכחי."
    : "PDF בלבד, עד 10MB.";

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
        name="doc_number"
        label="מספר קבלה"
        requiredMark={REQUIRED}
        hint="כפי שמופיע בקבלה שהופקה אצל הספק."
        autoComplete="off"
        dir="ltr"
        className="text-end"
        maxLength={DOC_NUMBER_MAX_LENGTH}
        defaultValue={values.doc_number}
        error={errors.doc_number}
      />
      <TextInputField
        name="issued_date"
        label="תאריך הפקת הקבלה"
        requiredMark={REQUIRED}
        type="date"
        min={MIN_ISO_DATE}
        max={today}
        defaultValue={values.issued_date}
        error={errors.issued_date}
      />

      <fieldset
        className="space-y-2"
        aria-describedby={errors.source ? SOURCE_ERROR_ID : undefined}
      >
        <legend className="text-sm font-medium">
          הקבלה מצורפת כ<span className="text-muted-foreground font-normal"> {REQUIRED}</span>
        </legend>
        <div className="flex flex-wrap gap-x-6">
          {(Object.keys(SOURCE_LABELS) as ReceiptSource[]).map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="source"
                value={option}
                checked={source === option}
                onChange={changeSource}
                disabled={!hydrated}
                className="size-5"
              />
              {SOURCE_LABELS[option]}
            </label>
          ))}
        </div>
        {/* Without JavaScript the disabled radios are not sent; this carries the choice. */}
        {hydrated ? null : <input type="hidden" name="source" value={source} />}
        {errors.source ? (
          <p id={SOURCE_ERROR_ID} className="text-destructive text-sm">
            {errors.source}
          </p>
        ) : null}
      </fieldset>

      <div hidden={source !== "file"}>
        <TextInputField
          name="file"
          label="קובץ הקבלה"
          requiredMark={hasStoredFile ? undefined : REQUIRED}
          hint={fileHint}
          type="file"
          accept={`${PDF_MIME_TYPE},.pdf`}
          className="py-2"
          error={errors.file}
        />
      </div>
      <div hidden={source !== "link"}>
        <TextInputField
          name="url"
          label="קישור לקבלה"
          requiredMark={REQUIRED}
          hint="קישור שמתחיל ב-https://, מועתק ממערכת הספק."
          type="url"
          inputMode="url"
          autoComplete="off"
          dir="ltr"
          maxLength={RECEIPT_URL_MAX_LENGTH}
          defaultValue={values.url}
          error={errors.url}
        />
      </div>

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
