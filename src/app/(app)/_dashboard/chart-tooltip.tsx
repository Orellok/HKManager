"use client";

import { formatAgorot } from "@/lib/money";

type TooltipEntry = { name?: unknown; value?: unknown; dataKey?: unknown };

/**
 * The hover/touch tooltip of the dashboard charts: the label and each series' amount, from
 * integer agorot (formatAgorot), right to left. Mouse and touch only; the same numbers are
 * in the table under each chart.
 */
export function AmountsTooltip({
  active,
  label,
  payload,
  labelFor,
}: {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipEntry[];
  labelFor: (label: unknown) => string;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  return (
    <div dir="rtl" className="bg-background rounded-md border p-2 text-sm shadow-md">
      <p className="font-medium">{labelFor(label)}</p>
      <ul>
        {payload.map((entry) => (
          <li key={String(entry.dataKey)}>
            {String(entry.name)}: {typeof entry.value === "number" ? formatAgorot(entry.value) : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
