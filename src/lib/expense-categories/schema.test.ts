import { describe, expect, it } from "vitest";

import { CATEGORY_FIELD_MESSAGES, validateCategoryInput } from "./schema";

describe("validateCategoryInput", () => {
  it("EXP-3: a name is required and trimmed", () => {
    expect(validateCategoryInput({ name: "  ציוד צילום  " })).toEqual({
      success: true,
      data: { name: "ציוד צילום" },
    });
    expect(validateCategoryInput({ name: "   " })).toEqual({
      success: false,
      fieldErrors: { name: CATEGORY_FIELD_MESSAGES.nameRequired },
    });
  });

  it("EXP-3: a name has at most 50 characters", () => {
    expect(validateCategoryInput({ name: "א".repeat(50) }).success).toBe(true);
    expect(validateCategoryInput({ name: "א".repeat(51) })).toEqual({
      success: false,
      fieldErrors: { name: CATEGORY_FIELD_MESSAGES.nameTooLong },
    });
  });

  it("EXP-3: names with quotes, commas and parentheses are kept as typed", () => {
    expect(validateCategoryInput({ name: 'קבלני משנה (הדמיות), "תלת-ממד"' })).toMatchObject({
      data: { name: 'קבלני משנה (הדמיות), "תלת-ממד"' },
    });
  });
});
