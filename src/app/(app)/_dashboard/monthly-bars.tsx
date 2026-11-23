"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { shortMonthLabel } from "@/lib/dashboard/period";
import type { MonthTotals } from "@/lib/dashboard/queries";
import { formatMonth } from "@/lib/incomes/month";
import { formatWholeShekels } from "@/lib/money";

import { EXPENSE_LABEL, INCOME_LABEL } from "./chart-labels";
import { AmountsTooltip } from "./chart-tooltip";

const CHART_HEIGHT = 288;
const Y_AXIS_WIDTH = 72;

/**
 * DASH-3: incomes against expenses for 12 months, as grouped bars (one value axis). Months
 * run right to left (RTL), the value axis is on the right. Amounts stay integer agorot; only
 * the axis labels round to whole shekels. No animation (reduced motion, and nothing moves
 * that the user did not ask for).
 */
export default function MonthlyBars({ series }: { series: readonly MonthTotals[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart
        data={[...series]}
        accessibilityLayer={false}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        barGap={2}
      >
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="month"
          reversed
          tickFormatter={(month: string) => shortMonthLabel(month)}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          interval="preserveStartEnd"
          tickLine={false}
        />
        <YAxis
          orientation="right"
          width={Y_AXIS_WIDTH}
          allowDecimals={false}
          tickFormatter={(agorot: number) => formatWholeShekels(agorot)}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={<AmountsTooltip labelFor={(month) => formatMonth(String(month))} />}
        />
        <Legend
          verticalAlign="top"
          align="right"
          height={32}
          iconType="square"
          // Text wears the text color; the square beside it carries the series color.
          formatter={(value: string) => <span className="text-foreground">{value}</span>}
        />
        <Bar
          dataKey="income"
          name={INCOME_LABEL}
          fill="var(--chart-income)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="expense"
          name={EXPENSE_LABEL}
          fill="var(--chart-expense)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
