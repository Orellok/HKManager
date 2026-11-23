"use client";

import dynamic from "next/dynamic";

import { CHART_CATEGORY_LIMIT, type ChartCategory } from "@/lib/dashboard/categories";

import { ChartFrame } from "./chart-frame";

/** Recharts loads after the page: the list shows at once, the chart a moment later. */
const CategoryBars = dynamic(() => import("./category-bars"), { ssr: false });

/**
 * The box height per number of bars (40px each, plus 32px for the axis; category-bars.tsx),
 * as literal classes: the box is sized by class, never by a style attribute (CSP).
 */
const HEIGHT_CLASSES: Record<number, string> = {
  1: "h-[72px]",
  2: "h-[112px]",
  3: "h-[152px]",
  4: "h-[192px]",
  5: "h-[232px]",
  6: "h-[272px]",
  7: "h-[312px]",
};

/** DASH-4: the categories chart (see category-bars.tsx), in a box of its final height. */
export function CategoryChart({
  categories,
  label,
}: {
  categories: readonly ChartCategory[];
  label: string;
}) {
  return (
    <ChartFrame
      label={label}
      heightClass={HEIGHT_CLASSES[categories.length] ?? HEIGHT_CLASSES[CHART_CATEGORY_LIMIT + 1]}
    >
      <CategoryBars categories={categories} />
    </ChartFrame>
  );
}
