import { describe, expect, it } from "vitest";

import { formatIsoDate, isIsoDate, isIsoDateInRange } from "./dates";

describe("isIsoDate", () => {
  it.each(["2026-11-16", "2024-02-29", "2026-12-31", "2027-01-01", "1900-01-01", "2100-12-31"])(
    "PRJ-1: %j is a date",
    (value) => {
      expect(isIsoDate(value)).toBe(true);
    },
  );

  it.each([
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-11-00",
    "16/11/2026",
    "2026-1-5",
    "2026-11-16T00:00",
    "",
    "abcd-ef-gh",
  ])("PRJ-1: %j is not a date", (value) => {
    expect(isIsoDate(value)).toBe(false);
  });
});

describe("isIsoDateInRange", () => {
  it.each([
    ["1899-12-31", false],
    ["1900-01-01", true],
    ["2026-11-16", true],
    ["2100-12-31", true],
    ["2101-01-01", false],
  ])("PRJ-1: %j in range: %s", (value, inRange) => {
    expect(isIsoDateInRange(value)).toBe(inRange);
  });
});

describe("formatIsoDate", () => {
  it.each([
    ["2026-11-16", "16/11/2026"],
    ["2026-12-31", "31/12/2026"],
    ["2027-01-01", "01/01/2027"],
    ["2026-03-27", "27/03/2026"],
  ])("PRJ-3: %j is shown as %j with no time zone shift", (value, shown) => {
    expect(formatIsoDate(value)).toBe(shown);
  });

  it("PRJ-3: refuses anything but YYYY-MM-DD", () => {
    expect(() => formatIsoDate("2026-11-16T22:00:00Z")).toThrow(RangeError);
  });
});
