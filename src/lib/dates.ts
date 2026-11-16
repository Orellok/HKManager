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
  // Date.UTC rolls an impossible day over to the next month; the round trip catches that.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Whether an ISO date is within MIN_ISO_DATE..MAX_ISO_DATE (ISO strings sort as dates). */
export function isIsoDateInRange(value: string): boolean {
  return value >= MIN_ISO_DATE && value <= MAX_ISO_DATE;
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
