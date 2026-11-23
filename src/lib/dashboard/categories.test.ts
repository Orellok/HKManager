import { describe, expect, it } from "vitest";

import {
  CHART_CATEGORY_LIMIT,
  OTHER_CATEGORIES_LABEL,
  chartCategories,
  sharePercent,
} from "./categories";

function category(index: number, total: number) {
  return { id: `id-${index}`, name: `קטגוריה ${index}`, total, count: 1 };
}

describe("DASH-4: expenses by category", () => {
  it("DASH-4: up to the limit, every category gets its own bar", () => {
    const categories = Array.from({ length: CHART_CATEGORY_LIMIT }, (_, index) =>
      category(index, 100 - index),
    );
    expect(chartCategories(categories)).toHaveLength(CHART_CATEGORY_LIMIT);
    expect(chartCategories([])).toEqual([]);
  });

  it("DASH-4: the rest are summed (integers) into one bar", () => {
    const categories = Array.from({ length: CHART_CATEGORY_LIMIT + 3 }, (_, index) =>
      category(index, 1_000 + index),
    );
    const bars = chartCategories(categories);
    expect(bars).toHaveLength(CHART_CATEGORY_LIMIT + 1);
    expect(bars.at(-1)).toEqual({
      key: "other",
      name: OTHER_CATEGORIES_LABEL,
      total: 1_006 + 1_007 + 1_008,
    });
  });

  it("DASH-4: shares are whole percents, floored, and 0 for an empty period", () => {
    expect(sharePercent(75_000, 100_000)).toBe(75);
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(2, 3)).toBe(66);
    expect(sharePercent(0, 0)).toBe(0);
  });
});
