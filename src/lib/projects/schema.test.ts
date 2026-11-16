import { describe, expect, it } from "vitest";

import {
  EMPTY_PROJECT_FORM_VALUES,
  PROJECT_FIELD_MESSAGES,
  PROJECT_TEXT_MAX_LENGTH,
  readProjectFormValues,
  validateProjectInput,
  type ProjectFormValues,
} from "./schema";

const CLIENT_ID = "6f1c2a0e-4b7d-4e8a-9c3f-2d5e8b1a7c90";

function values(overrides: Partial<ProjectFormValues>): ProjectFormValues {
  return { ...EMPTY_PROJECT_FORM_VALUES, client_id: CLIENT_ID, name: "שיפוץ מטבח", ...overrides };
}

function fieldErrors(input: ProjectFormValues) {
  const result = validateProjectInput(input);
  if (result.success) {
    throw new Error("expected validation to fail");
  }
  return result.fieldErrors;
}

describe("project schema", () => {
  it("PRJ-1: accepts client, name and status only; empty optional fields become null", () => {
    expect(validateProjectInput(values({}))).toEqual({
      success: true,
      data: {
        client_id: CLIENT_ID,
        name: "שיפוץ מטבח",
        property_address: null,
        status: "lead",
        contract_amount: null,
        start_date: null,
        end_date: null,
        notes: null,
      },
    });
  });

  it("PRJ-1: trims every field and converts the amount to agorot", () => {
    const result = validateProjectInput({
      client_id: ` ${CLIENT_ID} `,
      name: "  שיפוץ מטבח ",
      property_address: " הרצל 1, תל אביב ",
      status: "active",
      contract_amount: " 12,500.50 ",
      start_date: " 2026-11-16 ",
      end_date: "2027-01-01",
      notes: "  שורה\r\nשנייה  ",
    });

    expect(result).toEqual({
      success: true,
      data: {
        client_id: CLIENT_ID,
        name: "שיפוץ מטבח",
        property_address: "הרצל 1, תל אביב",
        status: "active",
        contract_amount: 1_250_050,
        start_date: "2026-11-16",
        end_date: "2027-01-01",
        notes: "שורה\nשנייה",
      },
    });
  });

  it.each(["", "   ", "not-a-uuid"])("PRJ-1: requires a client (%j)", (client_id) => {
    expect(fieldErrors(values({ client_id }))).toEqual({
      client_id: PROJECT_FIELD_MESSAGES.clientRequired,
    });
  });

  it.each(["", "   "])("PRJ-1: requires a name (%j)", (name) => {
    expect(fieldErrors(values({ name }))).toEqual({ name: PROJECT_FIELD_MESSAGES.nameRequired });
  });

  it.each(["lead", "active", "on_hold", "completed", "cancelled"])(
    "PRJ-2: accepts the status %j",
    (status) => {
      expect(validateProjectInput(values({ status })).success).toBe(true);
    },
  );

  it.each(["", "open", "deleted", "Active"])("PRJ-2: rejects the status %j", (status) => {
    expect(fieldErrors(values({ status }))).toEqual({
      status: PROJECT_FIELD_MESSAGES.statusRequired,
    });
  });

  it.each([
    ["0", 0],
    ["0.01", 1],
    ["12500", 1_250_000],
    ["12,500", 1_250_000],
    ["12,500.50", 1_250_050],
    ["99,999,999.99", 9_999_999_999],
  ])("PRJ-1: the contract amount %j is %i agorot", (contract_amount, agorot) => {
    const result = validateProjectInput(values({ contract_amount }));

    expect(result.success && result.data.contract_amount).toBe(agorot);
  });

  it.each([
    ["abc", PROJECT_FIELD_MESSAGES.amountInvalid],
    ["1,25", PROJECT_FIELD_MESSAGES.amountInvalid],
    ["12.505", PROJECT_FIELD_MESSAGES.amountTooManyDecimals],
    ["-100", PROJECT_FIELD_MESSAGES.amountNegative],
    ["100,000,000", PROJECT_FIELD_MESSAGES.amountTooLarge],
    ["١٢٣", PROJECT_FIELD_MESSAGES.amountLatinDigits],
    ["１２,５００", PROJECT_FIELD_MESSAGES.amountLatinDigits],
  ])("PRJ-1: rejects the contract amount %j", (contract_amount, message) => {
    expect(fieldErrors(values({ contract_amount }))).toEqual({ contract_amount: message });
  });

  it("PRJ-1: the non-Latin digits message says which digits to use", () => {
    expect(PROJECT_FIELD_MESSAGES.amountLatinDigits).toBe("יש להזין את הסכום בספרות 0–9 בלבד.");
  });

  it("PRJ-1: the too-large message names the limit in shekels", () => {
    expect(PROJECT_FIELD_MESSAGES.amountTooLarge).toContain("99,999,999.99");
    expect(PROJECT_FIELD_MESSAGES.amountTooLarge).toContain("₪");
  });

  it.each(["2026-02-30", "16/11/2026", "x", "0000-01-01"])(
    "PRJ-1: rejects the start date %j as not a date",
    (start_date) => {
      expect(fieldErrors(values({ start_date }))).toEqual({
        start_date: PROJECT_FIELD_MESSAGES.dateInvalid,
      });
    },
  );

  it.each([
    ["start_date", "1899-12-31"],
    ["start_date", "2101-01-01"],
    ["end_date", "2101-01-01"],
  ] as const)("PRJ-1: rejects the %s %j as out of range", (field, date) => {
    expect(fieldErrors(values({ [field]: date }))).toEqual({
      [field]: PROJECT_FIELD_MESSAGES.dateOutOfRange,
    });
  });

  it("PRJ-1: the out-of-range message names the range as DD/MM/YYYY", () => {
    expect(PROJECT_FIELD_MESSAGES.dateOutOfRange).toBe(
      "יש להזין תאריך בין 01/01/1900 ל-31/12/2100.",
    );
  });

  it("PRJ-1: accepts an end date equal to the start date", () => {
    expect(
      validateProjectInput(values({ start_date: "2026-11-16", end_date: "2026-11-16" })).success,
    ).toBe(true);
  });

  it("PRJ-1: accepts only one of the dates", () => {
    expect(validateProjectInput(values({ end_date: "2026-11-16" })).success).toBe(true);
    expect(validateProjectInput(values({ start_date: "2026-11-16" })).success).toBe(true);
  });

  it("PRJ-1: rejects an end date before the start date, across a year boundary too", () => {
    expect(fieldErrors(values({ start_date: "2027-01-01", end_date: "2026-12-31" }))).toEqual({
      end_date: PROJECT_FIELD_MESSAGES.endBeforeStart,
    });
  });

  it("PRJ-1: reports the date order together with other errors", () => {
    expect(
      fieldErrors(values({ name: "", start_date: "2026-11-16", end_date: "2026-11-15" })),
    ).toEqual({
      name: PROJECT_FIELD_MESSAGES.nameRequired,
      end_date: PROJECT_FIELD_MESSAGES.endBeforeStart,
    });
  });

  it("PRJ-1: accepts text fields at their maximum length and rejects one more", () => {
    const atMax = values({
      name: "א".repeat(PROJECT_TEXT_MAX_LENGTH.name),
      property_address: "ב".repeat(PROJECT_TEXT_MAX_LENGTH.property_address),
      notes: "ג".repeat(PROJECT_TEXT_MAX_LENGTH.notes),
    });
    expect(validateProjectInput(atMax).success).toBe(true);

    expect(
      fieldErrors(
        values({
          name: "א".repeat(PROJECT_TEXT_MAX_LENGTH.name + 1),
          property_address: "ב".repeat(PROJECT_TEXT_MAX_LENGTH.property_address + 1),
          notes: "ג".repeat(PROJECT_TEXT_MAX_LENGTH.notes + 1),
        }),
      ),
    ).toEqual({
      name: PROJECT_FIELD_MESSAGES.nameTooLong,
      property_address: PROJECT_FIELD_MESSAGES.propertyAddressTooLong,
      notes: PROJECT_FIELD_MESSAGES.notesTooLong,
    });
  });

  it("PRJ-1: notes the browser counts as 2000 characters pass when submitted with \\r\\n", () => {
    const typed = `${"ג".repeat(99)}\n`.repeat(19) + "ג".repeat(2000 - 19 * 100);
    const result = validateProjectInput(values({ notes: typed.replaceAll("\n", "\r\n") }));

    expect(result.success && result.data.notes).toBe(typed);
  });
});

describe("readProjectFormValues", () => {
  it("PRJ-1: reads the project fields and ignores anything else", () => {
    const formData = new FormData();
    formData.set("client_id", CLIENT_ID);
    formData.set("name", "מטבח");
    formData.set("created_by", "someone-else");
    formData.set("archived_at", "2026-01-01");

    expect(readProjectFormValues(formData)).toEqual({
      client_id: CLIENT_ID,
      name: "מטבח",
      property_address: "",
      status: "",
      contract_amount: "",
      start_date: "",
      end_date: "",
      notes: "",
    });
  });
});
