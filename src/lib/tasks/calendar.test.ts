import { describe, expect, it } from "vitest";

import {
  addMonths,
  calendarPath,
  calendarRange,
  datesBetween,
  dayLabel,
  monthLabel,
  parseCalendarParams,
  periodLabel,
  shiftedDate,
  weekStart,
  weekdayOf,
} from "./calendar";

describe("CAL-1 / CAL-11: calendar views and ranges (weeks start on Sunday)", () => {
  it("CAL-11: weekdays and week starts are Sunday-based", () => {
    expect(weekdayOf("2026-11-22")).toBe(0); // Sunday
    expect(weekdayOf("2026-11-28")).toBe(6); // Saturday
    expect(weekStart("2026-11-28")).toBe("2026-11-22");
    expect(weekStart("2026-11-22")).toBe("2026-11-22");
    expect(weekStart("2027-01-01")).toBe("2026-12-27");
    expect(weekdayOf("1900-01-01")).toBe(1); // Monday
  });

  it("CAL-1: agenda (default), day, week and month ranges", () => {
    expect(calendarRange({ view: "agenda", date: "2026-11-23" })).toEqual({
      from: "2026-11-23",
      to: "2026-12-06",
    });
    expect(calendarRange({ view: "day", date: "2026-11-23" })).toEqual({
      from: "2026-11-23",
      to: "2026-11-23",
    });
    expect(calendarRange({ view: "week", date: "2026-11-25" })).toEqual({
      from: "2026-11-22",
      to: "2026-11-28",
    });
    // November 2026: 1/11 is a Sunday, 30/11 a Monday.
    expect(calendarRange({ view: "month", date: "2026-11-17" })).toEqual({
      from: "2026-11-01",
      to: "2026-12-05",
    });
    // February 2026 starts on a Sunday and ends on a Saturday: exactly four weeks.
    expect(calendarRange({ view: "month", date: "2026-02-10" })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("CAL-9: a week spanning the DST changes still has seven calendar days", () => {
    expect(
      datesBetween(
        ...(Object.values(calendarRange({ view: "week", date: "2026-03-27" })) as [string, string]),
      ),
    ).toEqual([
      "2026-03-22",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
    ]);
    const october = calendarRange({ view: "week", date: "2026-10-25" });
    expect(datesBetween(october.from, october.to)).toHaveLength(7);
    expect(october).toEqual({ from: "2026-10-25", to: "2026-10-31" });
  });

  it("CAL-1: previous and next move by the view's period, months by calendar month", () => {
    expect(shiftedDate({ view: "agenda", date: "2026-11-23" }, 1)).toBe("2026-12-07");
    expect(shiftedDate({ view: "day", date: "2026-12-31" }, 1)).toBe("2027-01-01");
    expect(shiftedDate({ view: "week", date: "2026-11-23" }, -1)).toBe("2026-11-16");
    expect(shiftedDate({ view: "month", date: "2026-01-31" }, 1)).toBe("2026-02-01");
    expect(shiftedDate({ view: "month", date: "2026-01-15" }, -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-05", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-05", -13)).toBe("2024-12-01");
  });

  it("CAL-1: no previous before 1900 or next after 2100", () => {
    expect(shiftedDate({ view: "day", date: "1900-01-01" }, -1)).toBeNull();
    expect(shiftedDate({ view: "month", date: "2100-12-10" }, 1)).toBeNull();
  });

  it("CAL-1: the address gives the view and date; anything invalid falls back to agenda and today", () => {
    expect(parseCalendarParams({ view: "month", date: "2026-02-03" }, "2026-11-23")).toEqual({
      view: "month",
      date: "2026-02-03",
    });
    expect(parseCalendarParams({}, "2026-11-23")).toEqual({ view: "agenda", date: "2026-11-23" });
    expect(parseCalendarParams({ view: "year", date: "2026-02-30" }, "2026-11-23")).toEqual({
      view: "agenda",
      date: "2026-11-23",
    });
    expect(parseCalendarParams({ view: ["day"], date: "1800-01-01" }, "2026-11-23")).toEqual({
      view: "agenda",
      date: "2026-11-23",
    });
    expect(calendarPath({ view: "week", date: "2026-11-23" })).toBe(
      "/calendar?view=week&date=2026-11-23",
    );
  });

  it("CAL-1: labels in Hebrew with DD/MM/YYYY", () => {
    expect(dayLabel("2026-11-24")).toBe("יום שלישי, 24/11/2026");
    expect(monthLabel("2026-11-24")).toBe("נובמבר 2026");
    expect(periodLabel({ view: "week", date: "2026-11-24" })).toBe("22/11/2026 – 28/11/2026");
    expect(periodLabel({ view: "day", date: "2026-11-28" })).toBe("יום שבת, 28/11/2026");
  });
});
