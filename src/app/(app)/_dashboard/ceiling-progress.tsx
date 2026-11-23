import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { newCeilingPathForYear } from "@/lib/ceiling/paths";
import {
  PROGRESS_MAX,
  formatCeilingPercent,
  progressValue,
  type CeilingStatus,
  type TurnoverBasis,
} from "@/lib/ceiling/status";
import { formatAgorot } from "@/lib/money";

export const CEILING_HEADING_ID = "ceiling-heading";

const BASIS_TEXT: Record<TurnoverBasis, string> = {
  received_date: "המחזור מחושב לפי תאריך קבלת התשלום.",
  receipt_date: "המחזור מחושב לפי תאריך הקבלה שהופקה.",
};

/** CEIL-6: shown instead of any number when the year has no ceiling. */
export const CEILING_NOT_SET = "תקרה לא הוגדרה";

/**
 * CEIL-3: the exempt-dealer ceiling of the tax year: turnover, ceiling, percentage and what
 * is left, with a progress bar (a native <progress>, sized without style attributes).
 * CEIL-6: a year without a ceiling says so and never borrows another year's value; an admin
 * gets a link to set it.
 */
export function CeilingProgress({
  status,
  basis,
  isAdmin,
}: {
  status: CeilingStatus;
  basis: TurnoverBasis;
  isAdmin: boolean;
}) {
  return (
    <section aria-labelledby={CEILING_HEADING_ID} className="space-y-3 rounded-lg border p-4">
      <h2 id={CEILING_HEADING_ID} tabIndex={-1} className="text-xl font-semibold">
        תקרת עוסק פטור – {status.year}
      </h2>
      {status.state === "not_set" ? (
        <>
          <p className="text-lg font-semibold">{CEILING_NOT_SET}</p>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">מחזור</dt>
              <dd className="font-semibold">{formatAgorot(status.turnover)}</dd>
            </div>
          </dl>
          {isAdmin ? (
            <div className="space-y-2">
              <p className="text-sm">
                יש להגדיר את תקרת עוסק פטור לשנת {status.year}, כדי לעקוב אחרי המחזור ולקבל התראות.
              </p>
              <Link href={newCeilingPathForYear(status.year)} className={buttonClasses("primary")}>
                הגדרת התקרה לשנת {status.year}
              </Link>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">המנהל יעדכן את התקרה לשנה הזו בהגדרות.</p>
          )}
        </>
      ) : (
        <>
          <progress
            max={PROGRESS_MAX}
            value={progressValue(status.percentTenths)}
            aria-label={`מחזור ${status.year} מתוך התקרה`}
            aria-valuetext={formatCeilingPercent(status.percentTenths)}
            className="[&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary block h-4 w-full appearance-none overflow-hidden rounded-full border border-current [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full"
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-sm">מחזור</dt>
              <dd className="font-semibold">{formatAgorot(status.turnover)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">תקרה</dt>
              <dd className="font-semibold">{formatAgorot(status.ceiling)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">ניצול</dt>
              <dd className="font-semibold">{formatCeilingPercent(status.percentTenths)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">
                {status.excess > 0 ? "מעל התקרה" : "יתרה"}
              </dt>
              <dd className="font-semibold">
                {formatAgorot(status.excess > 0 ? status.excess : status.remaining)}
              </dd>
            </div>
          </dl>
        </>
      )}
      <p className="text-muted-foreground text-sm">{BASIS_TEXT[basis]}</p>
    </section>
  );
}
