import { z } from "zod";

/**
 * The client form schema (CLI-1), shared by the form in the browser and the Server Actions.
 * Owner decision (M1.1): only `name` is required. Values are trimmed; an empty optional field
 * is stored as null. The database repeats these limits as check constraints.
 */

export const CLIENT_FIELDS = ["name", "phone", "email", "address", "notes"] as const;

export type ClientField = (typeof CLIENT_FIELDS)[number];

export const CLIENT_FIELD_MAX_LENGTH: Record<ClientField, number> = {
  name: 120,
  phone: 30,
  email: 254,
  address: 200,
  notes: 2000,
};

/** Digits, spaces, "-" and "+", with at least one digit. */
const PHONE_PATTERN = /^[0-9 +-]*[0-9][0-9 +-]*$/;

export const CLIENT_FIELD_MESSAGES = {
  nameRequired: "יש להזין שם לקוח.",
  nameTooLong: `השם ארוך מדי (עד ${CLIENT_FIELD_MAX_LENGTH.name} תווים).`,
  phoneInvalid: "יש להזין מספר טלפון בספרות. מותר להוסיף רווחים, מקף (-) ופלוס (+).",
  phoneTooLong: `מספר הטלפון ארוך מדי (עד ${CLIENT_FIELD_MAX_LENGTH.phone} תווים).`,
  emailInvalid: "יש להזין כתובת מייל תקינה, למשל name@example.com.",
  emailTooLong: `כתובת המייל ארוכה מדי (עד ${CLIENT_FIELD_MAX_LENGTH.email} תווים).`,
  addressTooLong: `הכתובת ארוכה מדי (עד ${CLIENT_FIELD_MAX_LENGTH.address} תווים).`,
  notesTooLong: `ההערות ארוכות מדי (עד ${CLIENT_FIELD_MAX_LENGTH.notes} תווים).`,
} as const;

const emptyToNull = (value: string): string | null => (value === "" ? null : value);

function optionalText(field: ClientField, tooLong: string) {
  return z.string().trim().max(CLIENT_FIELD_MAX_LENGTH[field], { error: tooLong });
}

const emailFormat = z.email();

export const clientInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: CLIENT_FIELD_MESSAGES.nameRequired })
    .max(CLIENT_FIELD_MAX_LENGTH.name, { error: CLIENT_FIELD_MESSAGES.nameTooLong }),
  phone: optionalText("phone", CLIENT_FIELD_MESSAGES.phoneTooLong)
    .refine((value) => value === "" || PHONE_PATTERN.test(value), {
      error: CLIENT_FIELD_MESSAGES.phoneInvalid,
    })
    .transform(emptyToNull),
  email: optionalText("email", CLIENT_FIELD_MESSAGES.emailTooLong)
    .refine((value) => value === "" || emailFormat.safeParse(value).success, {
      error: CLIENT_FIELD_MESSAGES.emailInvalid,
    })
    .transform(emptyToNull),
  address: optionalText("address", CLIENT_FIELD_MESSAGES.addressTooLong).transform(emptyToNull),
  notes: optionalText("notes", CLIENT_FIELD_MESSAGES.notesTooLong).transform(emptyToNull),
});

/** What the user typed, as strings; kept so a failed save never loses input. */
export type ClientFormValues = Record<ClientField, string>;

/** A validated client, ready to store. */
export type ClientInput = z.output<typeof clientInputSchema>;

export type ClientFieldErrors = Partial<Record<ClientField, string>>;

export const EMPTY_CLIENT_FORM_VALUES: ClientFormValues = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

/** Reads the client fields from a submitted form. A missing or non-text field reads as "". */
export function readClientFormValues(formData: FormData): ClientFormValues {
  const values = { ...EMPTY_CLIENT_FORM_VALUES };
  for (const field of CLIENT_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

export type ClientValidationResult =
  { success: true; data: ClientInput } | { success: false; fieldErrors: ClientFieldErrors };

/** Validates form values; on failure returns the first message for each invalid field. */
export function validateClientInput(values: ClientFormValues): ClientValidationResult {
  const result = clientInputSchema.safeParse(values);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const flattened = z.flattenError(result.error).fieldErrors;
  const fieldErrors: ClientFieldErrors = {};
  for (const field of CLIENT_FIELDS) {
    const message = flattened[field]?.[0];
    if (message) {
      fieldErrors[field] = message;
    }
  }
  return { success: false, fieldErrors };
}

/** Client ids are uuids; anything else cannot name a client. */
export const clientIdSchema = z.uuid();

export const CLIENT_SEARCH_QUERY_MAX_LENGTH = 100;
