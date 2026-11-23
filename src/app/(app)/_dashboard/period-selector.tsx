import Form from "next/form";
import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { ViewTabs } from "@/components/view-tabs";
import {
  MAX_YEAR,
  MIN_YEAR,
  MONTH_PARAM,
  PERIOD_PARAM,
  YEAR_PARAM,
  periodHref,
  periodLabel,
  shiftPeriod,
  type DashboardPeriod,
} from "@/lib/dashboard/period";
import { MAX_MONTH, MIN_MONTH } from "@/lib/incomes/month";

const SHIFT_LABELS = {
  month: { previous: "החודש הקודם", next: "החודש הבא" },
  year: { previous: "השנה הקודמת", next: "השנה הבאה" },
} as const;

const INPUT_CLASSES =
  "border-input bg-background min-h-11 w-full rounded-md border px-3 text-base sm:w-44";

/** The month view of a year: the current month in the current year, December otherwise. */
function monthViewOf(period: DashboardPeriod, current: DashboardPeriod): DashboardPeriod {
  if (period.kind === "month") {
    return period;
  }
  if (current.kind === "month" && current.month.startsWith(`${period.year}-`)) {
    return current;
  }
  return { kind: "month", month: `${period.year}-12` };
}

function yearViewOf(period: DashboardPeriod): DashboardPeriod {
  return period.kind === "year" ? period : { kind: "year", year: Number(period.month.slice(0, 4)) };
}

/** Whether `period` is after `current` (both of the same kind). */
function isAfter(period: DashboardPeriod, current: DashboardPeriod): boolean {
  if (period.kind === "month" && current.kind === "month") {
    return period.month > current.month;
  }
  if (period.kind === "year" && current.kind === "year") {
    return period.year > current.year;
  }
  return false;
}

/**
 * DASH-1: month or year (links), the previous and next period (links, none after the current
 * one), and a GET form to jump to any month or year in 1900–2100. Everything is a plain link or a GET
 * form, so it works before hydration too; next/form navigates without a full reload.
 */
export function PeriodSelector({
  period,
  currentMonth,
}: {
  period: DashboardPeriod;
  /** The current month (Asia/Jerusalem), the default period. */
  currentMonth: DashboardPeriod;
}) {
  const current = period.kind === "month" ? currentMonth : yearViewOf(currentMonth);
  const previous = shiftPeriod(period, -1);
  const nextCandidate = shiftPeriod(period, 1);
  const next = nextCandidate && !isAfter(nextCandidate, current) ? nextCandidate : null;
  const labels = SHIFT_LABELS[period.kind];

  return (
    <section aria-labelledby="dashboard-period-heading" className="space-y-3">
      <h2 id="dashboard-period-heading" className="text-xl font-semibold">
        תקופה: {periodLabel(period)}
      </h2>
      <ViewTabs
        label="סוג התקופה"
        current={period.kind}
        tabs={[
          { key: "month", label: "חודש", href: periodHref(monthViewOf(period, currentMonth)) },
          { key: "year", label: "שנה", href: periodHref(yearViewOf(period)) },
        ]}
      />
      <nav aria-label="מעבר בין תקופות">
        <ul className="flex flex-wrap gap-2">
          {previous ? (
            <li>
              <Link href={periodHref(previous)} className={buttonClasses("secondary")}>
                {labels.previous}: {periodLabel(previous)}
              </Link>
            </li>
          ) : null}
          {next ? (
            <li>
              <Link href={periodHref(next)} className={buttonClasses("secondary")}>
                {labels.next}: {periodLabel(next)}
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
      {/* An empty or invalid value shows the current month (parsePeriod), so the form needs no
          validation of its own. */}
      <Form
        action="/"
        noValidate
        className="flex flex-wrap items-end gap-3"
        aria-label="בחירת תקופה"
      >
        <input type="hidden" name={PERIOD_PARAM} value={period.kind} />
        <div className="space-y-1.5">
          {period.kind === "month" ? (
            <>
              <label htmlFor="dashboard-month" className="block text-sm font-medium">
                חודש
              </label>
              <input
                id="dashboard-month"
                name={MONTH_PARAM}
                type="month"
                min={MIN_MONTH}
                max={MAX_MONTH}
                defaultValue={period.month}
                className={INPUT_CLASSES}
              />
            </>
          ) : (
            <>
              <label htmlFor="dashboard-year" className="block text-sm font-medium">
                שנה
              </label>
              <input
                id="dashboard-year"
                name={YEAR_PARAM}
                type="number"
                inputMode="numeric"
                min={MIN_YEAR}
                max={MAX_YEAR}
                step={1}
                defaultValue={period.year}
                className={INPUT_CLASSES}
              />
            </>
          )}
        </div>
        <button type="submit" className={buttonClasses("primary")}>
          הצגה
        </button>
      </Form>
    </section>
  );
}
