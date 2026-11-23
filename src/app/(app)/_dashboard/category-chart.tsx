"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_CATEGORY_LIMIT, type ChartCategory } from "@/lib/dashboard/categories";
import { formatWholeShekels } from "@/lib/money";

import { ChartFrame } from "./chart-frame";
import { AmountsTooltip } from "./chart-tooltip";
import { EXPENSE_LABEL } from "./monthly-chart";

const ROW_HEIGHT = 40;
const AXES_HEIGHT = 32;
const NAME_AXIS_WIDTH = 120;

/**
 * The box height per number of bars (ROW_HEIGHT each, plus the axis), as literal classes:
 * the box is sized by class, never by a style attribute (CSP).
 */
const HEIGHT_CLASSES: Record<number, string> = {
  1: "h-[72px]",
  2: "h-[112px]",
  3: "h-[152px]",
  4: "h-[192px]",
  5: "h-[232px]",
  6: "h-[272px]",
  [CHART_CATEGORY_LIMIT + 1]: "h-[312px]",
};

/**
 * DASH-4: the period's expenses per category, largest first, as horizontal bars (one hue:
 * a single series). The names sit on the right (RTL). The full list with amounts follows
 * the chart.
 */
export function CategoryChart({
  categories,
  label,
}: {
  categories: readonly ChartCategory[];
  label: string;
}) {
  const height = categories.length * ROW_HEIGHT + AXES_HEIGHT;
  return (
    <ChartFrame
      label={label}
      heightClass={HEIGHT_CLASSES[categories.length] ?? HEIGHT_CLASSES[CHART_CATEGORY_LIMIT + 1]}
    >
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
    </ChartFrame>
  );
}
