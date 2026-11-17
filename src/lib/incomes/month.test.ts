import { describe, expect, it } from "vitest";

import { formatMonth, isMonth, monthOf, monthStart } from "./month";

describe("months", () => {
  it.each(["2026-11", "1900-01", "2100-12", "2027-01"])("INC-1: %s is a month", (value) => {
    expect(isMonth(value)).toBe(true);
  });

  it.each(["", "2026-13", "2026-00", "2026-1", "1899-12", "2101-01", "2026-11-01", 202611, null])(
    "INC-1: %j is not a month",
    (value) => {
      expect(isMonth(value)).toBe(false);
    },
  );

  it("INC-1: the month of a date, its first day and its display", () => {
    expect(monthOf("2026-12-31")).toBe("2026-12");
    expect(monthStart("2027-01")).toBe("2027-01-01");
    expect(formatMonth("2027-01")).toBe("01/2027");
  });

  it("INC-1: a malformed month is rejected rather than queried", () => {
    expect(() => monthStart("2026-13")).toThrow(RangeError);
    expect(() => formatMonth("x")).toThrow(RangeError);
  });
});
