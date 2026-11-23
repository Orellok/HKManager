"use client";

import type { ReactNode } from "react";

import { useHydrated } from "@/components/use-hydrated";
import { cn } from "@/lib/utils";

/**
 * The box a Recharts chart draws in. The chart renders in the browser only: its server
 * render would put `style` attributes in the HTML, which the nonce CSP (style-src without
 * 'unsafe-inline') blocks, while styles set from script (CSSOM) are allowed. Until then the
 * box keeps its height, so nothing moves when the chart appears.
 *
 * The chart is a picture for sighted users (role="img" with a summary); its numbers are in
 * the table that follows it, which every user can reach (WCAG 1.1.1).
 */
export function ChartFrame({
  label,
  heightClass,
  children,
}: {
  label: string;
  heightClass: string;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  return (
    <div role="img" aria-label={label} dir="ltr" className={cn("w-full", heightClass)}>
      {hydrated ? children : null}
    </div>
  );
}
