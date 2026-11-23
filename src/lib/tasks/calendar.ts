import {
  MAX_ISO_DATE,
  MIN_ISO_DATE,
  addDays,
  daysBetween,
  formatIsoDate,
  isIsoDate,
  isIsoDateInRange,
} from "@/lib/dates";

/**
 * CAL-1 / CAL-9 / CAL-11: the in-app calendar's views and date ranges. Dates are calendar
 * dates (ISO strings) in Asia/Jerusalem; "today" comes from todayInJerusalem(). Weeks start on
 * Sunday (SPEC 8). All arithmetic is on UTC midnights (addDays), so no DST change can shift a
 * day. Only the view code and a date go into the address (SPEC 8).
 */

/** CAL-11: the in-app calendar. */
export const CALENDAR_PATH = "/calendar";

export const CALENDAR_VIEWS = ["agenda", "day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  agenda: "אג׳נדה",
  day: "יום",
  week: "שבוע",
  month: "חודש",
};

/** CAL-1: the default view (on mobile; lead decision: on desktop too). */
export const DEFAULT_CALENDAR_VIEW: CalendarView = "agenda";

/** The agenda shows this many days from its first date. */
export const AGENDA_DAYS = 14;

export const CALENDAR_VIEW_PARAM = "view";
export const CALENDAR_DATE_PARAM = "date";

export const WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
export const WEEKDAY_SHORT_NAMES = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;

const MONTH_NAMES = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

/** A known Sunday, the anchor for weekdays. */
const REFERENCE_SUNDAY = "1899-12-31";

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return ((daysBetween(REFERENCE_SUNDAY, date) % 7) + 7) % 7;
}

/** The Sunday on or before `date` (SPEC 8: the week starts on Sunday). */
export function weekStart(date: string): string {
  return addDays(date, -weekdayOf(date));
}

export function monthStartOf(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** The first day of the month `months` after the month of `date` (before it when negative). */
export function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1 + months;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonth = ((monthIndex % 12) + 12) % 12;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}-01`;
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const count = daysBetween(from, to) + 1;
  return Array.from({ length: Math.max(count, 0) }, (_, index) => addDays(from, index));
}

export type CalendarParams = { view: CalendarView; date: string };

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === "string" && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/**
 * The view and date named by the address; anything missing or invalid falls back to the
 * default view and today, never to an error page.
 */
export function parseCalendarParams(
  params: Record<string, string | string[] | undefined>,
  today: string,
): CalendarParams {
  const view = params[CALENDAR_VIEW_PARAM];
  const date = params[CALENDAR_DATE_PARAM];
  return {
    view: isCalendarView(view) ? view : DEFAULT_CALENDAR_VIEW,
    date: typeof date === "string" && isIsoDate(date) && isIsoDateInRange(date) ? date : today,
  };
}

export type CalendarRange = { from: string; to: string };

/**
 * The dates a view shows: the agenda AGENDA_DAYS days from the date, a day, the week (Sunday
 * to Saturday) of the date, or the whole weeks that cover the date's month.
 */
export function calendarRange({ view, date }: CalendarParams): CalendarRange {
  switch (view) {
    case "agenda":
      return { from: date, to: addDays(date, AGENDA_DAYS - 1) };
    case "day":
      return { from: date, to: date };
    case "week": {
      const from = weekStart(date);
      return { from, to: addDays(from, 6) };
    }
    case "month": {
      const first = monthStartOf(date);
      const last = addDays(addMonths(date, 1), -1);
      return { from: weekStart(first), to: addDays(weekStart(last), 6) };
    }
  }
}

/** The date the "previous" (-1) or "next" (+1) link opens, or null outside the app's range. */
export function shiftedDate({ view, date }: CalendarParams, direction: 1 | -1): string | null {
  let next: string;
  switch (view) {
    case "agenda":
      next = addDays(date, direction * AGENDA_DAYS);
      break;
    case "day":
      next = addDays(date, direction);
      break;
    case "week":
      next = addDays(date, direction * 7);
      break;
    case "month":
      next = addMonths(date, direction);
      break;
  }
  return next >= MIN_ISO_DATE && next <= MAX_ISO_DATE ? next : null;
}

export function calendarPath({ view, date }: CalendarParams): string {
  const query = new URLSearchParams({ [CALENDAR_VIEW_PARAM]: view, [CALENDAR_DATE_PARAM]: date });
  return `${CALENDAR_PATH}?${query}`;
}

/** "יום שלישי, 17/11/2026". */
export function dayLabel(date: string): string {
  return `יום ${WEEKDAY_NAMES[weekdayOf(date)]}, ${formatIsoDate(date)}`;
}

/** "נובמבר 2026". */
export function monthLabel(date: string): string {
  return `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(0, 4))}`;
}

/** The heading of a view's period. */
export function periodLabel(params: CalendarParams): string {
  if (params.view === "day") {
    return dayLabel(params.date);
  }
  if (params.view === "month") {
    return monthLabel(params.date);
  }
  const { from, to } = calendarRange(params);
  return `${formatIsoDate(from)} – ${formatIsoDate(to)}`;
}

/** How the previous/next links of a view are named. */
export const SHIFT_LABELS: Record<CalendarView, { previous: string; next: string }> = {
  agenda: { previous: "השבועיים הקודמים", next: "השבועיים הבאים" },
  day: { previous: "היום הקודם", next: "היום הבא" },
  week: { previous: "השבוע הקודם", next: "השבוע הבא" },
  month: { previous: "החודש הקודם", next: "החודש הבא" },
};
