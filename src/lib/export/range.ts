import { addDays, formatIsoDate, isIsoDate, isIsoDateInRange, todayInJerusalem } from "@/lib/dates";
import { DATE_MESSAGES } from "@/lib/field-rules";

/**
 * EXPORT-1 / criterion 5: the date range of an export. Both dates are calendar dates
 * (Asia/Jerusalem), inclusive, within the app's date bounds, from ≤ to, and at most
 * MAX_EXPORT_YEARS long. Shared by the export form (inline errors before any download) and
 * the Route Handlers (which check again and never trust the address).
 */

export const EXPORT_KINDS = ["incomes", "expenses"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_PATH = "/export";
export const FROM_PARAM = "from";
export const TO_PARAM = "to";
/** `?error=failed`: the last export could not be created (shown on the export screen). */
export const ERROR_PARAM = "error";
export const FAILED_ERROR = "failed";

/** The longest range one file may cover, in years. */
export const MAX_EXPORT_YEARS = 5;

export const EXPORT_MESSAGES = {
  fromMissing: "יש לבחור תאריך התחלה.",
  toMissing: "יש לבחור תאריך סיום.",
  order: "תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.",
  failed: "הייצוא נכשל ולא נוצר קובץ. אפשר לנסות שוב.",
} as const;

export function tooLongMessage(lastAllowed: string): string {
  return `אפשר לייצא עד ${MAX_EXPORT_YEARS} שנים בכל קובץ. לתאריך ההתחלה הזה, תאריך הסיום יכול להיות עד ${formatIsoDate(lastAllowed)}.`;
}

export type ExportRange = { from: string; to: string };
export type ExportRangeField = keyof ExportRange;

export type ExportRangeResult =
  | { ok: true; range: ExportRange }
  | { ok: false; errors: Partial<Record<ExportRangeField, string>> };

/** The address of an export's CSV file (a Route Handler): only dates go into it (SPEC 8). */
export function exportFilePath(kind: ExportKind, range: ExportRange): string {
  const query = new URLSearchParams({ [FROM_PARAM]: range.from, [TO_PARAM]: range.to });
  return `${EXPORT_PATH}/${kind}?${query}`;
}

/** An ASCII file name, e.g. "hkmanager-incomes-2026-01-01_2026-12-31.csv". */
export function exportFileName(kind: ExportKind, range: ExportRange): string {
  return `hkmanager-${kind}-${range.from}_${range.to}.csv`;
}

/** The same month and day MAX_EXPORT_YEARS later; 29/02 becomes 01/03 in a common year. */
function sameDayYearsLater(value: string, years: number): string {
  const year = String(Number(value.slice(0, 4)) + years).padStart(4, "0");
  const candidate = `${year}${value.slice(4)}`;
  return isIsoDate(candidate) ? candidate : `${year}-03-01`;
}

/** The last day a range starting on `from` may end on: one day before 5 years later. */
export function lastAllowedTo(from: string): string {
  return addDays(sameDayYearsLater(from, MAX_EXPORT_YEARS), -1);
}

function dateError(value: string, missingMessage: string): string | null {
  if (value === "") {
    return missingMessage;
  }
  if (!isIsoDate(value)) {
    return DATE_MESSAGES.invalid;
  }
  return isIsoDateInRange(value) ? null : DATE_MESSAGES.outOfRange;
}

/** Checks a submitted range; anything but strings counts as missing. */
export function validateExportRange(from: unknown, to: unknown): ExportRangeResult {
  const fromValue = typeof from === "string" ? from.trim() : "";
  const toValue = typeof to === "string" ? to.trim() : "";
  const fromError = dateError(fromValue, EXPORT_MESSAGES.fromMissing);
  const toError = dateError(toValue, EXPORT_MESSAGES.toMissing);
  if (fromError || toError) {
    return {
      ok: false,
      errors: { ...(fromError && { from: fromError }), ...(toError && { to: toError }) },
    };
  }
  if (toValue < fromValue) {
    return { ok: false, errors: { to: EXPORT_MESSAGES.order } };
  }
  const lastAllowed = lastAllowedTo(fromValue);
  if (toValue > lastAllowed) {
    return { ok: false, errors: { to: tooLongMessage(lastAllowed) } };
  }
  return { ok: true, range: { from: fromValue, to: toValue } };
}

/** The range the export screen opens with: 1 January of this year to today (Asia/Jerusalem). */
export function defaultExportRange(now: Date = new Date()): ExportRange {
  const today = todayInJerusalem(now);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}
