import { MAX_MONTH, MIN_MONTH, formatMonth, isMonth, monthOf } from "@/lib/incomes/month";

/**
 * DASH-1 / DASH-6: the dashboard's period, a calendar month or a calendar (tax) year. Months
 * are "YYYY-MM" strings and years integers; neither passes through a Date at a time of day,
 * so the period turns exactly at local midnight of 1/1 in Asia/Jerusalem, where "today"
 * comes from (todayInJerusalem()).
 */

export type DashboardPeriod = { kind: "month"; month: string } | { kind: "year"; year: number };

export const MIN_YEAR = Number(MIN_MONTH.slice(0, 4));
export const MAX_YEAR = Number(MAX_MONTH.slice(0, 4));

/** The URL parameters of the period (only fixed codes and dates, SPEC 8). */
export const PERIOD_PARAM = "period";
export const MONTH_PARAM = "month";
export const YEAR_PARAM = "year";

const YEAR_PATTERN = /^\d{4}$/;

export function isYear(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_YEAR && (value as number) <= MAX_YEAR;
}

function parseYear(value: unknown): number | null {
  if (typeof value !== "string" || !YEAR_PATTERN.test(value)) {
    return null;
  }
  const year = Number(value);
  return isYear(year) ? year : null;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

/** DASH-1 default: the current month. */
export function currentMonthPeriod(today: string): DashboardPeriod {
  return { kind: "month", month: monthOf(today) };
}

/**
 * The period a dashboard URL asks for: `?period=year&year=2026` or `?period=month&month=
 * 2026-11` (the form sends both fields; the period picks one). Anything missing or invalid
 * falls back to the current month (DASH-1).
 */
export function parsePeriod(
  params: Record<string, string | string[] | undefined>,
  today: string,
): DashboardPeriod {
  const kind = single(params[PERIOD_PARAM]);
  if (kind === "year") {
    const year = parseYear(single(params[YEAR_PARAM]));
    return year === null ? currentMonthPeriod(today) : { kind: "year", year };
  }
  const month = single(params[MONTH_PARAM]);
  return isMonth(month) ? { kind: "month", month } : currentMonthPeriod(today);
}

/** The first day of the period, as the database takes it. */
export function periodStart(period: DashboardPeriod): string {
  return period.kind === "month" ? `${period.month}-01` : `${period.year}-01-01`;
}

/** DASH-6: the tax year the period belongs to (the calendar year). */
export function taxYearOf(period: DashboardPeriod): number {
  return period.kind === "month" ? Number(period.month.slice(0, 4)) : period.year;
}

function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + by;
  const shiftedYear = Math.floor(index / 12);
  const shiftedMonth = (index % 12) + 1;
  return `${String(shiftedYear).padStart(4, "0")}-${String(shiftedMonth).padStart(2, "0")}`;
}

/** The period before or after (by = -1 / 1), or null outside 1900–2100. */
export function shiftPeriod(period: DashboardPeriod, by: number): DashboardPeriod | null {
  if (period.kind === "month") {
    const month = shiftMonth(period.month, by);
    return isMonth(month) ? { kind: "month", month } : null;
  }
  const year = period.year + by;
  return isYear(year) ? { kind: "year", year } : null;
}

/** The period that comparisons are made against (DASH-2). Never null: 1899 has no data. */
export function previousPeriodLabel(period: DashboardPeriod): string {
  if (period.kind === "month") {
    const month = shiftMonth(period.month, -1);
    const [year, number] = month.split("-");
    return `${number}/${year}`;
  }
  return String(period.year - 1);
}

/** "11/2026" or "2026". */
export function periodLabel(period: DashboardPeriod): string {
  return period.kind === "month" ? formatMonth(period.month) : String(period.year);
}

/** Whether two periods are the same. */
export function samePeriod(a: DashboardPeriod, b: DashboardPeriod): boolean {
  return a.kind === "month"
    ? b.kind === "month" && a.month === b.month
    : b.kind === "year" && a.year === b.year;
}

/** The dashboard's address for a period. */
export function periodHref(period: DashboardPeriod): string {
  const params = new URLSearchParams(
    period.kind === "month"
      ? { [PERIOD_PARAM]: "month", [MONTH_PARAM]: period.month }
      : { [PERIOD_PARAM]: "year", [YEAR_PARAM]: String(period.year) },
  );
  return `/?${params.toString()}`;
}

/** "2026-11" → "11/26", the short month label of the chart's axis. */
export function shortMonthLabel(month: string): string {
  if (!isMonth(month)) {
    throw new RangeError("Expected a month as YYYY-MM");
  }
  return `${month.slice(5, 7)}/${month.slice(2, 4)}`;
}
