import { describe, expect, it } from "vitest";

import { formatAgorot } from "@/lib/money";

import { compareToPrevious, comparisonText, formatPercentTenths } from "./comparison";

describe("DASH-2: comparison with the previous period", () => {
  it("DASH-2: difference and percentage, truncated to tenths", () => {
    expect(compareToPrevious(123_457, 100_000)).toEqual({ difference: 23_457, percentTenths: 234 });
    expect(compareToPrevious(50, 100)).toEqual({ difference: -50, percentTenths: -500 });
    expect(compareToPrevious(100_001, 100_000)).toEqual({ difference: 1, percentTenths: 0 });
    expect(compareToPrevious(100, 100)).toEqual({ difference: 0, percentTenths: 0 });
  });

  it("DASH-2: no percentage when the previous period is 0", () => {
    expect(compareToPrevious(500, 0)).toEqual({ difference: 500, percentTenths: null });
    expect(compareToPrevious(0, 0)).toEqual({ difference: 0, percentTenths: null });
    expect(formatPercentTenths(null)).toBe("—");
  });

  it("DASH-2: a negative profit is compared with its size (−100 → −50 is a 50% rise)", () => {
    expect(compareToPrevious(-50, -100)).toEqual({ difference: 50, percentTenths: 500 });
    expect(compareToPrevious(-300, 100)).toEqual({ difference: -400, percentTenths: -4000 });
  });

  it("DASH-2: large amounts stay exact", () => {
    // ₪99,999,999.99 against 1 agora: no float rounding.
    expect(compareToPrevious(9_999_999_999, 1)).toEqual({
      difference: 9_999_999_998,
      percentTenths: 9_999_999_998_000,
    });
    expect(compareToPrevious(9_999_999_999 * 2, 9_999_999_999)).toEqual({
      difference: 9_999_999_999,
      percentTenths: 1000,
    });
  });

  it("DASH-2: rejects amounts that are not safe integers", () => {
    expect(() => compareToPrevious(1.5, 1)).toThrow(RangeError);
    expect(() => compareToPrevious(1, Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it("DASH-2: the text says the direction in words", () => {
    expect(formatPercentTenths(234)).toBe("23.4%");
    expect(formatPercentTenths(-5)).toBe("0.5%");
    expect(comparisonText({ difference: 23_457, percentTenths: 234 }, "02/2026")).toBe(
      `עלייה של ${formatAgorot(23_457)} (23.4%) לעומת 02/2026`,
    );
    expect(comparisonText({ difference: -50, percentTenths: -500 }, "2025")).toBe(
      `ירידה של ${formatAgorot(50)} (50.0%) לעומת 2025`,
    );
    expect(comparisonText({ difference: 0, percentTenths: null }, "2025")).toBe(
      "ללא שינוי (—) לעומת 2025",
    );
    expect(comparisonText({ difference: 0, percentTenths: 0 }, "2025")).toBe(
      "ללא שינוי (0.0%) לעומת 2025",
    );
  });
});
