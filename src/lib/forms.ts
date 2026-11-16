import { z } from "@/lib/zod";

/**
 * Pieces shared by the form schemas (clients, projects) and their Server Actions: what the
 * user typed is kept as strings, validated with one zod schema in the browser and on the
 * server, and failures are reported as one message per field.
 */

/** The state of a form after a save attempt; what the user typed is kept so nothing is lost. */
export type ServerFormState<Field extends string> = {
  values: Record<Field, string>;
  fieldErrors: FieldErrors<Field>;
  formError: string | null;
};

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export type ValidationResult<Field extends string, Data> =
  { success: true; data: Data } | { success: false; fieldErrors: FieldErrors<Field> };

/**
 * Line breaks as "\n". A browser counts a textarea line break as one character but submits
 * it as "\r\n", so without this the server would count more characters than the form did
 * (and store "\r\n"). Applied before trimming and the length checks.
 */
export function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Runs `schema` on the value with its line breaks normalized. */
export function withNormalizedLineBreaks<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess(
    (value) => (typeof value === "string" ? normalizeLineBreaks(value) : value),
    schema,
  );
}

export const emptyToNull = (value: string): string | null => (value === "" ? null : value);

/** Reads `fields` from a submitted form. A missing or non-text field reads as "". */
export function readFormValues<Field extends string>(
  formData: FormData,
  fields: readonly Field[],
): Record<Field, string> {
  const values = {} as Record<Field, string>;
  for (const field of fields) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

/** Parses form values; on failure returns the first message for each invalid field. */
export function validateForm<Field extends string, Schema extends z.ZodType>(
  schema: Schema,
  fields: readonly Field[],
  values: Record<Field, string>,
): ValidationResult<Field, z.output<Schema>> {
  const result = schema.safeParse(values);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const flattened = z.flattenError(result.error).fieldErrors as Partial<
    Record<string, string[] | undefined>
  >;
  const fieldErrors: FieldErrors<Field> = {};
  for (const field of fields) {
    const message = flattened[field]?.[0];
    if (message) {
      fieldErrors[field] = message;
    }
  }
  return { success: false, fieldErrors };
}

/** The first field, in form order, that has an error. */
export function firstInvalidField<Field extends string>(
  fields: readonly Field[],
  errors: FieldErrors<Field>,
): Field | undefined {
  return fields.find((field) => errors[field]);
}
