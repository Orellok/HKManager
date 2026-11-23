import type { MonthTotals } from "@/lib/dashboard/queries";
import { formatMonth } from "@/lib/incomes/month";
import { formatAgorot } from "@/lib/money";

import { EXPENSE_LABEL, INCOME_LABEL, MonthlyChart } from "./monthly-chart";

/**
 * DASH-3: the 12-month chart, then the same numbers as a table (the chart's text
 * alternative), behind a disclosure so the screen stays short on a phone. The table scrolls
 * inside its own box if it ever gets wider than the screen.
 */
export function MonthlySection({ series }: { series: readonly MonthTotals[] }) {
  const first = formatMonth(series[0].month);
  const last = formatMonth(series[series.length - 1].month);
  const range = `${first} עד ${last}`;
  return (
    <section aria-labelledby="monthly-heading" className="space-y-3">
      <h2 id="monthly-heading" className="text-xl font-semibold">
        הכנסות מול הוצאות – 12 חודשים
      </h2>
      <p className="text-muted-foreground text-sm">{range}</p>
      <MonthlyChart
        series={series}
        label={`גרף עמודות של הכנסות מול הוצאות לכל חודש, ${range}. הנתונים בטבלה שאחרי הגרף.`}
      />
      <details className="rounded-lg border">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium">
          טבלת הנתונים של הגרף
        </summary>
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-sm">
            <caption className="sr-only">הכנסות והוצאות לפי חודש, {range}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="py-2 text-start font-medium">
                  חודש
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {INCOME_LABEL}
                </th>
                <th scope="col" className="py-2 text-start font-medium">
                  {EXPENSE_LABEL}
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((month) => (
                <tr key={month.month} className="border-b last:border-b-0">
                  <th scope="row" className="py-2 text-start font-normal">
                    {formatMonth(month.month)}
                  </th>
                  <td className="py-2">{formatAgorot(month.income)}</td>
                  <td className="py-2">{formatAgorot(month.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
