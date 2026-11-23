"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { ChartCategory } from "@/lib/dashboard/categories";
import { formatWholeShekels } from "@/lib/money";

import { EXPENSE_LABEL } from "./chart-labels";
import { AmountsTooltip } from "./chart-tooltip";

/** Keep in step with the box heights in category-chart.tsx. */
const ROW_HEIGHT = 40;
const AXES_HEIGHT = 32;
const NAME_AXIS_WIDTH = 120;

/**
 * DASH-4: the period's expenses per category, largest first, as horizontal bars (one hue:
 * a single series). The names sit on the right (RTL). The full list with amounts follows
 * the chart.
 */
export default function CategoryBars({ categories }: { categories: readonly ChartCategory[] }) {
  const height = categories.length * ROW_HEIGHT + AXES_HEIGHT;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={[...categories]}
        layout="vertical"
        accessibilityLayer={false}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          reversed
          allowDecimals={false}
          tickFormatter={(agorot: number) => formatWholeShekels(agorot)}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          orientation="right"
          width={NAME_AXIS_WIDTH}
          tick={{ fill: "var(--foreground)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={<AmountsTooltip labelFor={(name) => String(name)} />}
        />
        <Bar
          dataKey="total"
          name={EXPENSE_LABEL}
          fill="var(--chart-expense)"
          radius={[4, 0, 0, 4]}
          barSize={20}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
