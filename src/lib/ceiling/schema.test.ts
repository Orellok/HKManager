import { describe, expect, it } from "vitest";

import { CEILING_FIELD_MESSAGES, validateCeilingInput } from "./schema";

describe("CEIL-1: the yearly ceiling form", () => {
  it("CEIL-1: a year and a ceiling in shekels become a year and integer agorot", () => {
    expect(validateCeilingInput({ year: "2027", exempt_ceiling: "122,833" })).toEqual({
      success: true,
      data: { year: 2027, exempt_ceiling: 12_283_300 },
    });
    expect(validateCeilingInput({ year: " 1900 ", exempt_ceiling: "0.01" })).toEqual({
      success: true,
      data: { year: 1900, exempt_ceiling: 1 },
    });
  });

  it.each(["", "26", "20266", "1899", "2101", "2026.0", "abcd"])(
    "CEIL-1: rejects the year %j",
    (year) => {
      const result = validateCeilingInput({ year, exempt_ceiling: "1" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.fieldErrors.year).toBe(
          year === "" ? CEILING_FIELD_MESSAGES.yearRequired : CEILING_FIELD_MESSAGES.yearInvalid,
        );
      }
    },
  );

  it("CEIL-1: the ceiling is required, more than 0 and at most two decimals", () => {
    const cases: [string, string][] = [
      ["", CEILING_FIELD_MESSAGES.ceilingRequired],
      ["0", CEILING_FIELD_MESSAGES.ceilingNotPositive],
      ["1.234", "אפשר להזין עד שתי ספרות אחרי הנקודה (אגורות)."],
      ["-5", "הסכום לא יכול להיות שלילי."],
    ];
    for (const [value, message] of cases) {
      const result = validateCeilingInput({ year: "2027", exempt_ceiling: value });
      expect(result.success ? null : result.fieldErrors.exempt_ceiling).toBe(message);
    }
  });
});
