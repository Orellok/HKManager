import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { CEILINGS_HEADING_ID, NEW_CEILING_PATH, editCeilingPath } from "@/lib/ceiling/paths";
import type { TaxYearCeiling } from "@/lib/ceiling/queries";
import { formatAgorot } from "@/lib/money";

/**
 * CEIL-1 / SPEC 5.14 (admin only; the page renders it for admins): every tax year with its
 * exempt-dealer ceiling, newest first, with "עדכון" per year and "הוספת תקרה".
 */
export function CeilingList({
  ceilings,
  currentYear,
}: {
  ceilings: readonly TaxYearCeiling[];
  currentYear: number;
}) {
  const currentMissing = !ceilings.some((ceiling) => ceiling.year === currentYear);
  return (
    <section aria-labelledby={CEILINGS_HEADING_ID} className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={CEILINGS_HEADING_ID} tabIndex={-1} className="text-xl font-semibold">
          תקרות שנתיות
        </h2>
        <Link href={NEW_CEILING_PATH} className={buttonClasses("primary")}>
          הוספת תקרה
        </Link>
      </div>
      <p className="text-muted-foreground text-sm">
        תקרת המחזור של עוסק פטור לכל שנת מס (שנה קלנדרית). התקרה מתעדכנת מדי שנה ומוזנת ידנית. שנה
        בלי תקרה מוצגת בדף הבית כ&quot;תקרה לא הוגדרה&quot;.
      </p>
      {currentMissing ? (
        <p className="bg-muted rounded-md border-2 border-current p-3 text-sm">
          <strong>שימו לב:</strong> לא הוגדרה תקרה לשנת {currentYear}.
        </p>
      ) : null}
      {ceilings.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-4">עדיין לא הוגדרו תקרות.</p>
      ) : (
        <ul aria-label="תקרות לפי שנה" className="divide-y rounded-lg border">
          {ceilings.map((ceiling) => (
            <li
              key={ceiling.year}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2"
            >
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{ceiling.year}</span>
                <span className="font-semibold">{formatAgorot(ceiling.ceiling)}</span>
              </span>
              <Link
                href={editCeilingPath(ceiling.year)}
                aria-label={`עדכון התקרה של ${ceiling.year}`}
                className={buttonClasses("secondary")}
              >
                עדכון
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
