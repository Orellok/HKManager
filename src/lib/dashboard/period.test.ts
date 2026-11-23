import { describe, expect, it } from "vitest";

import { todayInJerusalem } from "@/lib/dates";

import {
  currentMonthPeriod,
  parsePeriod,
  periodHref,
  periodLabel,
  periodStart,
  previousPeriodLabel,
  shiftPeriod,
  shortMonthLabel,
  taxYearOf,
} from "./period";

const TODAY = "2026-11-23";

describe("DASH-1: the dashboard period", () => {
  it("DASH-1: defaults to the current month", () => {
    expect(parsePeriod({}, TODAY)).toEqual({ kind: "month", month: "2026-11" });
    expect(currentMonthPeriod(TODAY)).toEqual({ kind: "month", month: "2026-11" });
  });

  it("DASH-1: reads a month or a year from the address", () => {
    expect(parsePeriod({ period: "month", month: "2025-02" }, TODAY)).toEqual({
      kind: "month",
      month: "2025-02",
    });
    expect(parsePeriod({ month: "2025-02" }, TODAY)).toEqual({ kind: "month", month: "2025-02" });
    expect(parsePeriod({ period: "year", year: "2025", month: "2026-01" }, TODAY)).toEqual({
      kind: "year",
      year: 2025,
    });
  });

  it.each([
    [{ period: "year", year: "1899" }],
    [{ period: "year", year: "2101" }],
    [{ period: "year", year: "25" }],
    [{ period: "year", year: "2025.5" }],
    [{ period: "year" }],
    [{ period: "month", month: "2026-13" }],
    [{ period: "month", month: "" }],
    [{ period: "month", month: ["2026-01", "2026-02"] }],
    [{ period: "week", month: "x" }],
  ])("DASH-1: an invalid period %j falls back to the current month", (params) => {
    expect(parsePeriod(params, TODAY)).toEqual({ kind: "month", month: "2026-11" });
  });

  it("DASH-6: the period's first day and tax year are calendar based", () => {
    expect(periodStart({ kind: "month", month: "2026-12" })).toBe("2026-12-01");
    expect(periodStart({ kind: "year", year: 2027 })).toBe("2027-01-01");
    expect(taxYearOf({ kind: "month", month: "2026-12" })).toBe(2026);
    expect(taxYearOf({ kind: "month", month: "2027-01" })).toBe(2027);
    expect(taxYearOf({ kind: "year", year: 2027 })).toBe(2027);
  });

  it("DASH-2: previous and next periods cross the year boundary", () => {
    expect(shiftPeriod({ kind: "month", month: "2027-01" }, -1)).toEqual({
      kind: "month",
      month: "2026-12",
    });
    expect(shiftPeriod({ kind: "month", month: "2026-12" }, 1)).toEqual({
      kind: "month",
      month: "2027-01",
    });
    expect(shiftPeriod({ kind: "year", year: 2026 }, -1)).toEqual({ kind: "year", year: 2025 });
    expect(previousPeriodLabel({ kind: "month", month: "2027-01" })).toBe("12/2026");
    expect(previousPeriodLabel({ kind: "year", year: 2027 })).toBe("2026");
  });

  it("DASH-1: no period outside 1900–2100", () => {
    expect(shiftPeriod({ kind: "month", month: "1900-01" }, -1)).toBeNull();
    expect(shiftPeriod({ kind: "month", month: "2100-12" }, 1)).toBeNull();
    expect(shiftPeriod({ kind: "year", year: 1900 }, -1)).toBeNull();
    expect(shiftPeriod({ kind: "year", year: 2100 }, 1)).toBeNull();
    expect(previousPeriodLabel({ kind: "month", month: "1900-01" })).toBe("12/1899");
  });

  it("DASH-1: labels and addresses", () => {
    expect(periodLabel({ kind: "month", month: "2026-03" })).toBe("03/2026");
    expect(periodLabel({ kind: "year", year: 2026 })).toBe("2026");
    expect(periodHref({ kind: "month", month: "2026-03" })).toBe("/?period=month&month=2026-03");
    expect(periodHref({ kind: "year", year: 2026 })).toBe("/?period=year&year=2026");
    expect(shortMonthLabel("2026-03")).toBe("03/26");
    expect(() => shortMonthLabel("2026-3")).toThrow(RangeError);
  });

  it("DASH-6: the default month turns at midnight on 31/12 in Asia/Jerusalem, not UTC", () => {
    // 31/12/2026 23:30 in Israel (UTC+2) is 21:30 UTC: still December 2026.
    const lastEvening = todayInJerusalem(new Date("2026-12-31T21:30:00Z"));
    expect(currentMonthPeriod(lastEvening)).toEqual({ kind: "month", month: "2026-12" });
    expect(taxYearOf(currentMonthPeriod(lastEvening))).toBe(2026);
    // 1/1/2027 00:30 in Israel is still 31/12 22:30 UTC: already January 2027.
    const firstNight = todayInJerusalem(new Date("2026-12-31T22:30:00Z"));
    expect(currentMonthPeriod(firstNight)).toEqual({ kind: "month", month: "2027-01" });
    expect(taxYearOf(currentMonthPeriod(firstNight))).toBe(2027);
  });
});
