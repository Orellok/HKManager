import { compareToPrevious, comparisonText } from "@/lib/dashboard/comparison";
import type { DashboardData } from "@/lib/dashboard/queries";
import { formatAgorot } from "@/lib/money";

type Measure = { key: string; label: string; current: number; previous: number };

/**
 * DASH-2: the period's incomes, expenses and profit (incomes − expenses), each compared with
 * the previous period: the difference and the percentage, "—" when the previous value is 0.
 */
export function PeriodSummary({
  data,
  periodLabel,
  previousLabel,
}: {
  data: DashboardData["period"];
  periodLabel: string;
  previousLabel: string;
}) {
  const measures: Measure[] = [
    { key: "income", label: "הכנסות", current: data.income, previous: data.previousIncome },
    { key: "expense", label: "הוצאות", current: data.expense, previous: data.previousExpense },
    {
      key: "profit",
      label: "רווח",
      current: data.income - data.expense,
      previous: data.previousIncome - data.previousExpense,
    },
  ];
  return (
    <section aria-labelledby="period-summary-heading" className="space-y-3">
      <h2 id="period-summary-heading" className="text-xl font-semibold">
        סיכום {periodLabel}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {measures.map((measure) => (
          <div key={measure.key} className="space-y-1 rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{measure.label}</dt>
            <dd className="text-2xl font-semibold wrap-anywhere">
              {formatAgorot(measure.current)}
            </dd>
            <dd className="text-sm wrap-anywhere">
              {comparisonText(compareToPrevious(measure.current, measure.previous), previousLabel)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
