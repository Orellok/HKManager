/**
 * Calendar dates (Postgres DATE) travel as ISO strings, "YYYY-MM-DD", exactly as the native
 * <input type="date"> submits them and PostgREST returns them. They are never turned into a
 * Date at a time of day, so no time zone can shift them by a day.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The range the app accepts; the database repeats it as a check constraint. */
export const MIN_ISO_DATE = "1900-01-01";
export const MAX_ISO_DATE = "2100-12-31";

/** Whether `value` is "YYYY-MM-DD" naming a real calendar day (no 31/04, no 29/02/2026). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number);
  // An impossible day rolls over to the next month; the round trip catches that.
  const date = utcMidnight(year, month, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Midnight UTC of a calendar day. setUTCFullYear, unlike Date.UTC, takes years 0–99
 * literally (Date.UTC(50, 0, 1) is 1950), so "0050-01-01" stays in year 50.
 */
function utcMidnight(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

/** Whether an ISO date is within MIN_ISO_DATE..MAX_ISO_DATE (ISO strings sort as dates). */
export function isIsoDateInRange(value: string): boolean {
  return value >= MIN_ISO_DATE && value <= MAX_ISO_DATE;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): Date {
  if (!isIsoDate(value)) {
    throw new RangeError("Expected a date as YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  return utcMidnight(year, month, day);
}

/**
 * Whole days from `from` to `to` (both ISO dates); negative when `to` is earlier. Counted on
 * UTC midnights, where every day has 24 hours, so a DST change cannot add or lose an hour.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY);
}

/** The business runs in Israel (profile: timezone Asia/Jerusalem). */
export const BUSINESS_TIME_ZONE = "Asia/Jerusalem";

const BUSINESS_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar date in Asia/Jerusalem at the moment `now`, as "YYYY-MM-DD": the one source of
 * "today" for the app (MS-2 status, MS-6 open debts). Called on the server; `now` is
 * injectable so midnight and DST changes can be tested. The time zone database handles
 * Israel's summer time, so the date turns at local midnight all year.
 */
export function todayInJerusalem(now: Date = new Date()): string {
  const parts = BUSINESS_DATE_FORMAT.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** "2026-11-16" → "16/11/2026" (SPEC 8: DD/MM/YYYY). */
export function formatIsoDate(value: string): string {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError("Expected a date as YYYY-MM-DD");
  }
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}
