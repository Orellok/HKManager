import { formatAgorot } from "@/lib/money";

/**
 * DASH-2: a measure of the period against the period before it. Amounts are integer agorot;
 * the percentage is computed with BigInt, so no floating point touches money.
 */

export type Comparison = {
  /** current − previous, in agorot. */
  difference: number;
  /**
   * The change relative to the size of the previous value, in tenths of a percent, truncated
   * toward zero (123 = 12.3%). Null when the previous value is 0 (shown as "—").
   */
  percentTenths: number | null;
};

export function compareToPrevious(current: number, previous: number): Comparison {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(previous)) {
    throw new RangeError("Amounts in agorot must be safe integers");
  }
  const difference = current - previous;
  if (previous === 0) {
    return { difference, percentTenths: null };
  }
  // Relative to |previous|, so a profit that grows from −100 to −50 is a rise (+50%).
  const base = BigInt(Math.abs(previous));
  // BigInt division truncates toward zero.
  const percentTenths = Number((BigInt(difference) * BigInt(1000)) / base);
  return { difference, percentTenths };
}

/** 123 → "12.3%", −5 → "0.5%" (the direction is said in words); null → "—". */
export function formatPercentTenths(percentTenths: number | null): string {
  if (percentTenths === null) {
    return "—";
  }
  const magnitude = Math.abs(percentTenths);
  return `${Math.trunc(magnitude / 10)}.${magnitude % 10}%`;
}

/**
 * The comparison as one line of text, direction in words (RTL-safe, not color alone):
 * "עלייה של ‏1,200.00 ‏₪ (12.5%) לעומת 10/2026", "ללא שינוי (—) לעומת 2025".
 */
export function comparisonText(comparison: Comparison, previousLabel: string): string {
  const percent = formatPercentTenths(comparison.percentTenths);
  const suffix = `לעומת ${previousLabel}`;
  if (comparison.difference === 0) {
    return `ללא שינוי (${percent}) ${suffix}`;
  }
  const direction = comparison.difference > 0 ? "עלייה" : "ירידה";
  return `${direction} של ${formatAgorot(Math.abs(comparison.difference))} (${percent}) ${suffix}`;
}
