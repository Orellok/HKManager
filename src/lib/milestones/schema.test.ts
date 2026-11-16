import { describe, expect, it } from "vitest";

import { AMOUNT_MESSAGES, DATE_MESSAGES } from "@/lib/field-rules";

import {
  EMPTY_MILESTONE_FORM_VALUES,
  MILESTONE_FIELD_MESSAGES,
  validateMilestoneInput,
  type MilestoneFormValues,
} from "./schema";

function values(fields: Partial<MilestoneFormValues> = {}): MilestoneFormValues {
  return { description: "מקדמה", amount: "12,500", due_date: "2026-12-01", ...fields };
}

function fieldErrors(input: MilestoneFormValues) {
  const result = validateMilestoneInput(input);
  return result.success ? {} : result.fieldErrors;
}

describe("milestone schema", () => {
  it("MS-1: accepts a description, an amount in shekels and a due date; stores agorot", () => {
    expect(
      validateMilestoneInput(values({ amount: "₪12,500.50", description: "  מקדמה  " })),
    ).toEqual({
      success: true,
      data: { description: "מקדמה", amount: 1_250_050, due_date: "2026-12-01" },
    });
  });

  it("MS-1: description, amount and due date are required", () => {
    expect(fieldErrors(EMPTY_MILESTONE_FORM_VALUES)).toEqual({
      description: MILESTONE_FIELD_MESSAGES.descriptionRequired,
      amount: MILESTONE_FIELD_MESSAGES.amountRequired,
      due_date: MILESTONE_FIELD_MESSAGES.dueDateRequired,
    });
  });

  it("MS-1: whitespace only counts as empty", () => {
    expect(fieldErrors(values({ description: "   ", amount: " ", due_date: " " }))).toEqual({
      description: MILESTONE_FIELD_MESSAGES.descriptionRequired,
      amount: MILESTONE_FIELD_MESSAGES.amountRequired,
      due_date: MILESTONE_FIELD_MESSAGES.dueDateRequired,
    });
  });

  it("MS-1: an amount of 0 is allowed", () => {
    const result = validateMilestoneInput(values({ amount: "0" }));
    expect(result.success && result.data.amount).toBe(0);
  });

  it("MS-1: a description of 200 characters is allowed, 201 is not", () => {
    expect(validateMilestoneInput(values({ description: "א".repeat(200) })).success).toBe(true);
    expect(fieldErrors(values({ description: "א".repeat(201) }))).toEqual({
      description: MILESTONE_FIELD_MESSAGES.descriptionTooLong,
    });
  });

  it("MS-1: a line break counts as one character, as the browser counts it", () => {
    const description = `${"א".repeat(99)}\r\n${"ב".repeat(100)}`;
    const result = validateMilestoneInput(values({ description }));
    expect(result.success && result.data.description).toBe(`${"א".repeat(99)}\n${"ב".repeat(100)}`);
  });

  it.each([
    ["abc", AMOUNT_MESSAGES.invalid],
    ["١٢", AMOUNT_MESSAGES.non_latin_digits],
    ["1.005", AMOUNT_MESSAGES.too_many_decimals],
    ["-1", AMOUNT_MESSAGES.negative],
    ["100,000,000", AMOUNT_MESSAGES.too_large],
  ])("MS-1: the amount %j is rejected", (amount, message) => {
    expect(fieldErrors(values({ amount }))).toEqual({ amount: message });
  });

  it.each([
    ["2026-02-30", DATE_MESSAGES.invalid],
    ["01/12/2026", DATE_MESSAGES.invalid],
    ["1899-12-31", DATE_MESSAGES.outOfRange],
    ["2101-01-01", DATE_MESSAGES.outOfRange],
    // Years 0001–0099 are real dates outside the range (M1.3-10).
    ["0050-01-01", DATE_MESSAGES.outOfRange],
  ])("MS-1: the due date %j is rejected", (due_date, message) => {
    expect(fieldErrors(values({ due_date }))).toEqual({ due_date: message });
  });
});
