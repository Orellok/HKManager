"use client";

import dynamic from "next/dynamic";

import type { MonthTotals } from "@/lib/dashboard/queries";

import { ChartFrame } from "./chart-frame";

/** Recharts loads after the page: the numbers show at once, the chart a moment later. */
const MonthlyBars = dynamic(() => import("./monthly-bars"), { ssr: false });

/**
 * DASH-3: incomes against expenses for 12 months (see monthly-bars.tsx), in its box. The
 * box keeps its height while the chart loads.
 */
export function MonthlyChart({ series, label }: { series: readonly MonthTotals[]; label: string }) {
  return (
    <ChartFrame label={label} heightClass="h-72">
      <MonthlyBars series={series} />
    </ChartFrame>
  );
}
