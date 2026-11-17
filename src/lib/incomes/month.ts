/**
 * Months of the incomes list (INC-1) as "YYYY-MM", the value of <input type="month">. Like
 * calendar dates (src/lib/dates.ts), they stay strings and never pass through a Date at a
 * time of day.
 */

import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const MIN_MONTH = MIN_ISO_DATE.slice(0, 7);
export const MAX_MONTH = MAX_ISO_DATE.slice(0, 7);

/** Whether `value` is "YYYY-MM" within the app's date range. */
export function isMonth(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MONTH_PATTERN.test(value) &&
    value >= MIN_MONTH &&
    value <= MAX_MONTH
  );
}

/** The month of an ISO date: "2026-11-16" → "2026-11". */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** The first day of a month, as the database filters by it: "2026-11" → "2026-11-01". */
export function monthStart(month: string): string {
  if (!isMonth(month)) {
    throw new RangeError("Expected a month as YYYY-MM");
  }
  return `${month}-01`;
}

/** "2026-11" → "11/2026" (SPEC 8 date order). */
export function formatMonth(month: string): string {
  if (!isMonth(month)) {
    throw new RangeError("Expected a month as YYYY-MM");
  }
  const [year, number] = month.split("-");
  return `${number}/${year}`;
}
