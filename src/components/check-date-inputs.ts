import { DATE_MESSAGES } from "@/lib/field-rules";
import type { FieldErrors } from "@/lib/forms";

/**
 * A date input with a partly typed date (e.g. day and month without a year) submits "",
 * which would silently drop the date (or report it as missing); the browser flags it as
 * validity.badInput. For useServerForm's checkControls.
 */
export function checkDateInputs<Field extends string>(
  form: HTMLFormElement,
  fields: readonly Field[],
): FieldErrors<Field> {
  const errors: FieldErrors<Field> = {};
  for (const field of fields) {
    const input = form.elements.namedItem(field);
    if (input instanceof HTMLInputElement && input.validity.badInput) {
      errors[field] = DATE_MESSAGES.invalid;
    }
  }
  return errors;
}
