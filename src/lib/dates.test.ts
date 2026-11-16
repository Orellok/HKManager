import { describe, expect, it } from "vitest";

import { daysBetween, formatIsoDate, isIsoDate, isIsoDateInRange, todayInJerusalem } from "./dates";

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

describe("isIsoDate: years 0001–0099", () => {
  it.each(["0001-01-01", "0050-06-15", "0099-12-31", "0004-02-29"])(
    "M1.3-10: %j is a real date in its own year, not in the 1900s",
    (value) => {
      expect(isIsoDate(value)).toBe(true);
      expect(isIsoDateInRange(value)).toBe(false);
    },
  );

  it.each(["0050-02-29", "0099-04-31", "0000-01-01"])("M1.3-10: %j is not a date", (value) => {
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

describe("daysBetween", () => {
  it.each([
    ["2026-11-16", "2026-11-16", 0],
    ["2026-11-15", "2026-11-16", 1],
    ["2026-11-16", "2026-11-15", -1],
    ["2026-12-31", "2027-01-01", 1],
    ["2024-02-28", "2024-03-01", 2],
    // Israel's summer time starts on 27/03/2026 and ends on 25/10/2026.
    ["2026-03-26", "2026-03-28", 2],
    ["2026-10-24", "2026-10-26", 2],
    ["1900-01-01", "2100-12-31", 73413],
  ])("MS-6: from %j to %j is %i days", (from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });

  it("MS-6: refuses anything but a real YYYY-MM-DD date", () => {
    expect(() => daysBetween("2026-02-30", "2026-03-01")).toThrow(RangeError);
  });
});

describe("todayInJerusalem", () => {
  it.each([
    // Winter time (UTC+2): the date turns at 22:00 UTC.
    ["2026-11-16T21:59:59.999Z", "2026-11-16"],
    ["2026-11-16T22:00:00.000Z", "2026-11-17"],
    // New year in Israel while it is still 31/12 in UTC.
    ["2026-12-31T22:00:00.000Z", "2027-01-01"],
    // Summer time (UTC+3): the date turns at 21:00 UTC.
    ["2026-07-01T20:59:59.999Z", "2026-07-01"],
    ["2026-07-01T21:00:00.000Z", "2026-07-02"],
    // Summer time starts at 02:00 on 27/03/2026: that day's midnight is still UTC+2, the next
    // one already UTC+3.
    ["2026-03-26T21:59:59.999Z", "2026-03-26"],
    ["2026-03-26T22:00:00.000Z", "2026-03-27"],
    ["2026-03-27T00:30:00.000Z", "2026-03-27"],
    ["2026-03-27T20:59:59.999Z", "2026-03-27"],
    ["2026-03-27T21:00:00.000Z", "2026-03-28"],
    // Summer time ends at 02:00 on 25/10/2026: that day's midnight is still UTC+3, the next
    // one UTC+2 again.
    ["2026-10-24T20:59:59.999Z", "2026-10-24"],
    ["2026-10-24T21:00:00.000Z", "2026-10-25"],
    ["2026-10-25T21:59:59.999Z", "2026-10-25"],
    ["2026-10-25T22:00:00.000Z", "2026-10-26"],
  ])("MS-2: at %s it is %s in Asia/Jerusalem", (instant, today) => {
    expect(todayInJerusalem(new Date(instant))).toBe(today);
  });

  it("MS-2: without an argument it reads the current clock", () => {
    expect(isIsoDate(todayInJerusalem())).toBe(true);
  });
});
