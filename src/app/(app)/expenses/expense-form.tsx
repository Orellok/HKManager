"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { checkDateInputs } from "@/components/check-date-inputs";
import { SelectField, TextInputField, TextareaField } from "@/components/form-field";
import { useHydrated } from "@/components/use-hydrated";
import {
  SAVE_UNAVAILABLE_MESSAGE,
  useServerForm,
  type BeforeSaveResult,
} from "@/components/use-server-form";
import { callServerAction } from "@/lib/auth/action-failure";
import { MIN_ISO_DATE, todayInJerusalem } from "@/lib/dates";
import { prepareExpenseUploadAction, type ExpenseFormState } from "@/lib/expenses/actions";
import { ImageCompressionError, compressImage } from "@/lib/expenses/compress";
import {
  EXPENSE_FILES_BUCKET,
  EXPENSE_FILE_ACCEPT,
  EXPENSE_FILE_MESSAGES,
  checkChosenFile,
  checkUploadFileContent,
  isImageType,
} from "@/lib/expenses/file";
import { KEEP_ORIGINAL_MESSAGE } from "@/lib/expenses/paths";
import {
  EXPENSE_FIELDS,
  EXPENSE_FILE_PATH_FIELD,
  EXPENSE_NOTES_MAX_LENGTH,
  VENDOR_MAX_LENGTH,
  readExpenseFormValues,
  validateExpenseInput,
  type ExpenseField,
  type ExpenseFormValues,
} from "@/lib/expenses/schema";
import { removeRejectedUpload, uploadToSignedPath } from "@/lib/files/browser-upload";
import { PDF_MIME_TYPE } from "@/lib/files/signatures";
import type { FieldErrors } from "@/lib/forms";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";

type ExpenseFormProps = {
  action: (state: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  initialValues: ExpenseFormValues;
  /** Active categories in order, plus the expense's own category when it is archived. */
  categoryOptions: readonly { value: string; label: string }[];
  /** Today in Asia/Jerusalem, from the server: the latest date the date input offers. */
  today: string;
  /** Editing an expense that has a file: its viewing link (a new file replaces it). */
  currentFileHref: string | null;
  submitLabel: string;
  cancelHref: string;
};

const REQUIRED = "(חובה)";
const OPTIONAL = "(לא חובה)";
const DATE_FIELDS = ["expense_date"] as const;
const UPLOAD_FAILED = "העלאת הקובץ נכשלה. בדקו את החיבור ונסו שוב.";
/** The inputs that can hold the receipt: the camera, or a chosen file. */
const PHOTO_INPUT = "photo";
const FILE_INPUT = "file";
const FILE_HINT_ID = "expense-file-hint";
const FILE_ERROR_ID = "expense-file-error";

const PAYMENT_METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}));

function validateForToday(values: ExpenseFormValues) {
  return validateExpenseInput(values, todayInJerusalem());
}

function inputFile(form: HTMLFormElement, name: string): File | undefined {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement ? (input.files?.[0] ?? undefined) : undefined;
}

/**
 * Focus for a rejected receipt goes to the input that holds it: the camera input when the
 * receipt is a photo, otherwise the file input (the field's own name).
 */
function receiptFieldElement(form: HTMLFormElement, field: ExpenseField): HTMLElement | null {
  if (field !== "file" || !inputFile(form, PHOTO_INPUT)) {
    return null;
  }
  const photo = form.elements.namedItem(PHOTO_INPUT);
  return photo instanceof HTMLInputElement ? photo : null;
}

/** The receipt chosen in the form: the photo or the file, whichever was chosen last. */
function chosenFile(form: HTMLFormElement): File | undefined {
  return inputFile(form, PHOTO_INPUT) ?? inputFile(form, FILE_INPUT);
}

/**
 * EXP-1 / EXP-2 / EXP-6: the expense form (saving, validation, errors and failed requests:
 * see useServerForm). The receipt is optional: a photo from the camera (`capture`) or a
 * chosen JPEG, PNG or PDF; without one the expense is marked "חסר מסמך".
 *
 * A file never travels in the form data. After validation, a photo is compressed in the
 * browser (canvas, longest side ≤ 2000px, JPEG, EXIF orientation applied), the result is
 * checked (type, size, signature), the server hands out a signed upload URL, the browser
 * uploads straight to the private bucket and saves with the stored path; the server checks
 * the stored file again before the expense records it.
 */
export function ExpenseForm({
  action,
  initialValues,
  categoryOptions,
  today,
  currentFileHref,
  submitLabel,
  cancelHref,
}: ExpenseFormProps) {
  /** The name of the receipt chosen, shown under the inputs. */
  const [chosenName, setChosenName] = useState<string | null>(null);
  // A file chosen before hydration would be posted with the form to the Server Action, which
  // ignores it; the inputs wait for hydration.
  const hydrated = useHydrated();

  function checkControls(form: HTMLFormElement): FieldErrors<ExpenseField> {
    const errors: FieldErrors<ExpenseField> = checkDateInputs(form, DATE_FIELDS);
    const file = chosenFile(form);
    const problem = file ? checkChosenFile(file) : null;
    if (problem) {
      errors.file = EXPENSE_FILE_MESSAGES[problem];
    }
    return errors;
  }

  /** The bytes to upload: a photo compressed to a JPEG, a PDF as it is. */
  async function uploadable(file: File): Promise<Blob | FieldErrors<ExpenseField>> {
    const problem = checkChosenFile(file);
    if (problem) {
      return { file: EXPENSE_FILE_MESSAGES[problem] };
    }
    if (!isImageType(file.type)) {
      // Sent with the type it was checked for, whatever type the system gave the file.
      return new Blob([file], { type: PDF_MIME_TYPE });
    }
    try {
      return await compressImage(file);
    } catch (error) {
      if (error instanceof ImageCompressionError) {
        return { file: EXPENSE_FILE_MESSAGES.unreadable_image };
      }
      throw error;
    }
  }

  async function uploadChosenFile(formData: FormData): Promise<BeforeSaveResult<ExpenseField>> {
    // The file goes to Storage, never to the Server Action.
    formData.delete(PHOTO_INPUT);
    formData.delete(FILE_INPUT);
    formData.delete(EXPENSE_FILE_PATH_FIELD);
    const file = formRef.current ? chosenFile(formRef.current) : undefined;
    if (!file) {
      return { status: "ready" };
    }
    const blob = await uploadable(file);
    if (!(blob instanceof Blob)) {
      return { status: "rejected", fieldErrors: blob };
    }
    const problem = await checkUploadFileContent(blob);
    if (problem) {
      return { status: "rejected", fieldErrors: { file: EXPENSE_FILE_MESSAGES[problem] } };
    }
    const call = await callServerAction(() =>
      prepareExpenseUploadAction({ size: blob.size, type: blob.type }),
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
    if (!(await uploadToSignedPath(EXPENSE_FILES_BUCKET, path, token, blob))) {
      return { status: "rejected", formError: UPLOAD_FAILED };
    }
    formData.set(EXPENSE_FILE_PATH_FIELD, path);
    return { status: "ready" };
  }

  /** The server answered that it did not save, so the upload was not recorded: remove it. */
  function removeUploadOfRejectedSave(formData: FormData) {
    const path = formData.get(EXPENSE_FILE_PATH_FIELD);
    if (typeof path === "string" && path !== "") {
      removeRejectedUpload(EXPENSE_FILES_BUCKET, path);
    }
  }

  const { formRef, formAction, handleSubmit, values, errors, formMessage, pending } = useServerForm(
    {
      action,
      initialValues,
      fields: EXPENSE_FIELDS,
      read: readExpenseFormValues,
      validate: validateForToday,
      checkControls,
      beforeSave: uploadChosenFile,
      afterRejectedSave: removeUploadOfRejectedSave,
      fieldElement: receiptFieldElement,
    },
  );

  /** One receipt per expense: choosing in one input clears the other. */
  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const otherName = input.name === PHOTO_INPUT ? FILE_INPUT : PHOTO_INPUT;
    const other = input.form?.elements.namedItem(otherName);
    const file = input.files?.[0];
    if (file && other instanceof HTMLInputElement) {
      other.value = "";
    }
    setChosenName(file ? file.name : (chosenFileName(input.form) ?? null));
  }

  const fileError = errors.file;
  const fileDescribedBy = [fileError ? FILE_ERROR_ID : null, FILE_HINT_ID]
    .filter(Boolean)
    .join(" ");
  const fileInputClasses =
    "border-input bg-background aria-invalid:border-destructive min-h-11 w-full rounded-md border px-3 py-2 text-base aria-invalid:border-2";

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
        name="expense_date"
        label="תאריך ההוצאה"
        requiredMark={REQUIRED}
        type="date"
        min={MIN_ISO_DATE}
        max={today}
        defaultValue={values.expense_date}
        error={errors.expense_date}
      />
      <TextInputField
        name="amount"
        label="סכום (₪)"
        requiredMark={REQUIRED}
        hint="בשקלים, למשל 350 או 1,250.90."
        inputMode="decimal"
        autoComplete="off"
        dir="ltr"
        className="text-end"
        defaultValue={values.amount}
        error={errors.amount}
      />
      <TextInputField
        name="vendor"
        label="ספק"
        requiredMark={REQUIRED}
        hint="שם העסק שממנו נקנה, כפי שמופיע בקבלה."
        autoComplete="off"
        maxLength={VENDOR_MAX_LENGTH}
        defaultValue={values.vendor}
        error={errors.vendor}
      />
      <SelectField
        name="category_id"
        label="קטגוריה"
        requiredMark={REQUIRED}
        placeholder="בחירת קטגוריה"
        options={categoryOptions}
        defaultValue={values.category_id}
        error={errors.category_id}
      />
      <SelectField
        name="payment_method"
        label="אמצעי תשלום"
        requiredMark={REQUIRED}
        placeholder="בחירת אמצעי תשלום"
        options={PAYMENT_METHOD_OPTIONS}
        defaultValue={values.payment_method}
        error={errors.payment_method}
      />
      <TextareaField
        name="notes"
        label="הערות"
        requiredMark={OPTIONAL}
        maxLength={EXPENSE_NOTES_MAX_LENGTH}
        defaultValue={values.notes}
        error={errors.notes}
      />

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          קבלה<span className="text-muted-foreground font-normal"> {OPTIONAL}</span>
        </legend>
        <p id={FILE_HINT_ID} className="text-muted-foreground text-sm">
          {currentFileHref
            ? "להוצאה יש קובץ מצורף. צילום או קובץ חדש יחליפו אותו; הקובץ הקודם נשמר."
            : 'צילום, תמונה (JPEG או PNG) או PDF, עד 10MB. תמונה מוקטנת לפני ההעלאה. אפשר לשמור בלי קבלה, וההוצאה תסומן "חסר מסמך".'}
        </p>
        {currentFileHref ? (
          <div className="bg-muted space-y-2 rounded-md border p-3 text-sm">
            <a
              href={currentFileHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              צפייה בקובץ המצורף
              <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
            </a>
            <p className="font-medium">{KEEP_ORIGINAL_MESSAGE}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="expense-photo" className="block text-sm font-medium">
            צילום הקבלה במצלמה
          </label>
          <input
            id="expense-photo"
            name={PHOTO_INPUT}
            type="file"
            accept="image/*"
            capture="environment"
            disabled={!hydrated}
            onChange={chooseFile}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileDescribedBy}
            className={fileInputClasses}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="expense-file" className="block text-sm font-medium">
            או בחירת קובץ מהמכשיר
          </label>
          <input
            id="expense-file"
            name={FILE_INPUT}
            type="file"
            accept={EXPENSE_FILE_ACCEPT}
            disabled={!hydrated}
            onChange={chooseFile}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileDescribedBy}
            className={fileInputClasses}
          />
        </div>
        <p role="status" className="text-sm empty:sr-only">
          {chosenName ? `נבחר: ${chosenName}` : null}
        </p>
        {fileError ? (
          <p id={FILE_ERROR_ID} className="text-destructive text-sm">
            {fileError}
          </p>
        ) : null}
      </fieldset>

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

/** The name of the receipt still chosen in the form, if any. */
function chosenFileName(form: HTMLFormElement | null): string | undefined {
  return form ? chosenFile(form)?.name : undefined;
}
