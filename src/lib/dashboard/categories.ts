import type { CategoryTotal } from "./queries";

/** DASH-4: the chart shows this many categories; the rest are summed into one bar. */
export const CHART_CATEGORY_LIMIT = 6;

export const OTHER_CATEGORIES_LABEL = "שאר הקטגוריות";

export type ChartCategory = { key: string; name: string; total: number };

/**
 * The bars of the categories chart: the largest CHART_CATEGORY_LIMIT categories as given
 * (largest first), then one bar for the rest when there are more. Integer sums only.
 */
export function chartCategories(categories: readonly CategoryTotal[]): ChartCategory[] {
  const shown = categories
    .slice(0, CHART_CATEGORY_LIMIT)
    .map((category) => ({ key: category.id, name: category.name, total: category.total }));
  const rest = categories.slice(CHART_CATEGORY_LIMIT);
  if (rest.length === 0) {
    return shown;
  }
  const total = rest.reduce((sum, category) => sum + category.total, 0);
  return [...shown, { key: "other", name: OTHER_CATEGORIES_LABEL, total }];
}

/** Each category's share of the period's expenses in whole percent (floor), from integers. */
export function sharePercent(total: number, periodTotal: number): number {
  if (periodTotal <= 0) {
    return 0;
  }
  return Number((BigInt(total) * BigInt(100)) / BigInt(periodTotal));
}
