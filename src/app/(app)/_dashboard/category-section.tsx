import { chartCategories, sharePercent } from "@/lib/dashboard/categories";
import type { CategoryTotal } from "@/lib/dashboard/queries";
import { formatAgorot } from "@/lib/money";

import { CategoryChart } from "./category-chart";

function countText(count: number): string {
  return count === 1 ? "הוצאה אחת" : `${count} הוצאות`;
}

/**
 * DASH-4: the period's expenses by category: a bar chart of the largest ones, then every
 * category as a list with its amount, share and number of expenses (the chart's text
 * alternative). The empty period says so instead of an empty chart.
 */
export function CategorySection({
  categories,
  periodTotal,
  periodLabel,
}: {
  categories: readonly CategoryTotal[];
  periodTotal: number;
  periodLabel: string;
}) {
  return (
    <section aria-labelledby="categories-heading" className="space-y-3">
      <h2 id="categories-heading" className="text-xl font-semibold">
        הוצאות לפי קטגוריה – {periodLabel}
      </h2>
      {categories.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-4">
          אין הוצאות בתקופה הזו. כאן יופיע הפילוח של ההוצאות לפי קטגוריה.
        </p>
      ) : (
        <>
          <CategoryChart
            categories={chartCategories(categories)}
            label={`גרף עמודות של ההוצאות לפי קטגוריה, ${periodLabel}. הפירוט ברשימה שאחרי הגרף.`}
          />
          <ul aria-label="פירוט ההוצאות לפי קטגוריה" className="divide-y rounded-lg border">
            {categories.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
              >
                <span className="font-medium wrap-anywhere">{category.name}</span>
                <span className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="text-base font-semibold">{formatAgorot(category.total)}</span>
                  <span>{sharePercent(category.total, periodTotal)}%</span>
                  <span className="text-muted-foreground">{countText(category.count)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
