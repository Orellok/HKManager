import { describe, expect, it } from "vitest";

import {
  CLIENT_FIELD_MAX_LENGTH,
  CLIENT_FIELD_MESSAGES,
  EMPTY_CLIENT_FORM_VALUES,
  normalizeLineBreaks,
  readClientFormValues,
  validateClientInput,
  type ClientFormValues,
} from "./schema";

function values(overrides: Partial<ClientFormValues>): ClientFormValues {
  return { ...EMPTY_CLIENT_FORM_VALUES, name: "דנה לוי", ...overrides };
}

function fieldErrors(input: ClientFormValues) {
  const result = validateClientInput(input);
  if (result.success) {
    throw new Error("expected validation to fail");
  }
  return result.fieldErrors;
}

describe("client schema", () => {
  it("CLI-1: accepts a name only; empty optional fields become null", () => {
    const result = validateClientInput(values({}));

    expect(result).toEqual({
      success: true,
      data: { name: "דנה לוי", phone: null, email: null, address: null, notes: null },
    });
  });

  it("CLI-1: trims every field and treats whitespace-only optional fields as empty", () => {
    const result = validateClientInput({
      name: "  דנה לוי  ",
      phone: " 050-123-4567 ",
      email: " dana@example.com ",
      address: "  רחוב הרצל 1, תל אביב ",
      notes: "   ",
    });

    expect(result).toEqual({
      success: true,
      data: {
        name: "דנה לוי",
        phone: "050-123-4567",
        email: "dana@example.com",
        address: "רחוב הרצל 1, תל אביב",
        notes: null,
      },
    });
  });

  it.each(["", "   "])("CLI-1: requires a name (%j)", (name) => {
    expect(fieldErrors(values({ name }))).toEqual({ name: CLIENT_FIELD_MESSAGES.nameRequired });
  });

  it.each(["050-1234567", "+972 50 123 4567", "0501234567", "03 123-4567"])(
    "CLI-1: accepts the phone %j",
    (phone) => {
      expect(validateClientInput(values({ phone })).success).toBe(true);
    },
  );

  it.each(["050.123.4567", "(050) 1234567", "abc", "---", "+ -", "050#1"])(
    "CLI-1: rejects the phone %j",
    (phone) => {
      expect(fieldErrors(values({ phone }))).toEqual({ phone: CLIENT_FIELD_MESSAGES.phoneInvalid });
    },
  );

  it.each(["dana@example.com", "a.b+c@sub.example.co.il"])(
    "CLI-1: accepts the email %j",
    (email) => {
      expect(validateClientInput(values({ email })).success).toBe(true);
    },
  );

  it.each(["dana", "dana@", "@example.com", "dana@example", "da na@example.com"])(
    "CLI-1: rejects the email %j",
    (email) => {
      expect(fieldErrors(values({ email }))).toEqual({ email: CLIENT_FIELD_MESSAGES.emailInvalid });
    },
  );

  it("CLI-1: accepts every field at its maximum length", () => {
    const result = validateClientInput({
      name: "א".repeat(CLIENT_FIELD_MAX_LENGTH.name),
      phone: "1".repeat(CLIENT_FIELD_MAX_LENGTH.phone),
      email: `${"a".repeat(CLIENT_FIELD_MAX_LENGTH.email - "@example.com".length)}@example.com`,
      address: "ב".repeat(CLIENT_FIELD_MAX_LENGTH.address),
      notes: "ג".repeat(CLIENT_FIELD_MAX_LENGTH.notes),
    });

    expect(result.success).toBe(true);
  });

  it("CLI-1: rejects every field one character over its maximum length", () => {
    const errors = fieldErrors({
      name: "א".repeat(CLIENT_FIELD_MAX_LENGTH.name + 1),
      phone: "1".repeat(CLIENT_FIELD_MAX_LENGTH.phone + 1),
      email: `${"a".repeat(CLIENT_FIELD_MAX_LENGTH.email + 1 - "@example.com".length)}@example.com`,
      address: "ב".repeat(CLIENT_FIELD_MAX_LENGTH.address + 1),
      notes: "ג".repeat(CLIENT_FIELD_MAX_LENGTH.notes + 1),
    });

    expect(errors).toEqual({
      name: CLIENT_FIELD_MESSAGES.nameTooLong,
      phone: CLIENT_FIELD_MESSAGES.phoneTooLong,
      email: CLIENT_FIELD_MESSAGES.emailTooLong,
      address: CLIENT_FIELD_MESSAGES.addressTooLong,
      notes: CLIENT_FIELD_MESSAGES.notesTooLong,
    });
  });

  it("CLI-1: measures the maximum length after trimming", () => {
    const name = ` ${"א".repeat(CLIENT_FIELD_MAX_LENGTH.name)} `;

    expect(validateClientInput(values({ name })).success).toBe(true);
  });

  it("CLI-1: keeps names with quotes, commas and mixed scripts", () => {
    const name = `ג'ון "ג'וני" Doe, בע"מ`;
    const result = validateClientInput(values({ name }));

    expect(result.success && result.data.name).toBe(name);
  });

  it("CLI-1: reports one message per invalid field", () => {
    expect(fieldErrors(values({ name: "", phone: "x", email: "y" }))).toEqual({
      name: CLIENT_FIELD_MESSAGES.nameRequired,
      phone: CLIENT_FIELD_MESSAGES.phoneInvalid,
      email: CLIENT_FIELD_MESSAGES.emailInvalid,
    });
  });
});

describe("line breaks", () => {
  it.each([
    ["a\r\nb", "a\nb"],
    ["a\rb", "a\nb"],
    ["a\nb", "a\nb"],
  ])("CLI-1: normalizes %j to %j", (input, output) => {
    expect(normalizeLineBreaks(input)).toBe(output);
  });

  it("CLI-1: notes the browser counts as 2000 characters pass when submitted with \\r\\n", () => {
    // 19 line breaks: 2000 characters as typed, 2019 as a browser submits them.
    const typed = `${"ג".repeat(99)}\n`.repeat(19) + "ג".repeat(2000 - 19 * 100);
    expect(typed).toHaveLength(CLIENT_FIELD_MAX_LENGTH.notes);
    const submitted = typed.replaceAll("\n", "\r\n");

    const result = validateClientInput(values({ notes: submitted }));

    expect(result.success && result.data.notes).toBe(typed);
  });

  it("CLI-1: a note over the limit after normalizing is still rejected", () => {
    const submitted = `${"ג".repeat(2000)}\r\nג`;

    expect(fieldErrors(values({ notes: submitted }))).toEqual({
      notes: CLIENT_FIELD_MESSAGES.notesTooLong,
    });
  });

  it("CLI-1: trailing line breaks are trimmed after normalizing", () => {
    const result = validateClientInput(values({ notes: "שורה\r\n\r\n" }));

    expect(result.success && result.data.notes).toBe("שורה");
  });
});

describe("readClientFormValues", () => {
  it("CLI-1: reads the client fields and ignores anything else", () => {
    const formData = new FormData();
    formData.set("name", "דנה");
    formData.set("phone", "050");
    formData.set("created_by", "someone-else");

    expect(readClientFormValues(formData)).toEqual({
      name: "דנה",
      phone: "050",
      email: "",
      address: "",
      notes: "",
    });
  });

  it("CLI-1: reads a file in place of a text field as empty", () => {
    const formData = new FormData();
    formData.set("name", new Blob(["x"]), "name.txt");

    expect(readClientFormValues(formData).name).toBe("");
  });
});
