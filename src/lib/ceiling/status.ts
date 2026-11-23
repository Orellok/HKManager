/**
 * CEIL-3..6: the exempt-dealer ceiling of a tax year against its turnover. Amounts are
 * integer agorot; every comparison and percentage uses BigInt, so no floating point decides
 * whether a threshold was crossed.
 */

/** CEIL-4: the thresholds whose banner can be acknowledged. Mirrors the database check. */
export const CEILING_THRESHOLDS = [70, 85, 95] as const;

export type CeilingThreshold = (typeof CEILING_THRESHOLDS)[number];

/** CEIL-5: from this percentage the banner cannot be dismissed. */
export const CEILING_EXCEEDED_PERCENT = 100;

export function isCeilingThreshold(value: unknown): value is CeilingThreshold {
  return CEILING_THRESHOLDS.includes(value as CeilingThreshold);
}

export type TurnoverBasis = "received_date" | "receipt_date";

export type CeilingInput = {
  year: number;
  /** Agorot, or null when the year has no ceiling (CEIL-6). */
  ceiling: number | null;
  /** Agorot. */
  turnover: number;
  /** Thresholds already acknowledged for the year (CEIL-4). */
  acked: readonly number[];
};

export type CeilingStatus =
  | { state: "not_set"; year: number; turnover: number }
  | {
      state: "set";
      year: number;
      ceiling: number;
      turnover: number;
      /** turnover / ceiling in tenths of a percent, truncated (724 = 72.4%). */
      percentTenths: number;
      /** What is left until the ceiling, never below 0. */
      remaining: number;
      /** How far the turnover is above the ceiling, 0 when it is not. */
      excess: number;
      /** The highest threshold crossed (70/85/95), or 100 at or above the ceiling. */
      crossed: CeilingThreshold | typeof CEILING_EXCEEDED_PERCENT | null;
      /**
       * CEIL-4: the threshold banner to show: the highest crossed threshold below 100 that is
       * not acknowledged yet (it stands for the lower ones). Null at 100% (CEIL-5 shows its
       * own banner instead) and when nothing is waiting.
       */
      banner: CeilingThreshold | null;
    };

/** Whether turnover has reached `percent` of the ceiling: turnover × 100 ≥ ceiling × percent. */
export function hasReached(turnover: number, ceiling: number, percent: number): boolean {
  return BigInt(turnover) * BigInt(100) >= BigInt(ceiling) * BigInt(percent);
}

export function ceilingStatus({ year, ceiling, turnover, acked }: CeilingInput): CeilingStatus {
  if (!Number.isSafeInteger(turnover) || turnover < 0) {
    throw new RangeError("The turnover must be a non-negative safe integer");
  }
  if (ceiling === null) {
    return { state: "not_set", year, turnover };
  }
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0) {
    throw new RangeError("The ceiling must be a positive safe integer");
  }
  const exceeded = hasReached(turnover, ceiling, CEILING_EXCEEDED_PERCENT);
  const crossedThreshold =
    [...CEILING_THRESHOLDS]
      .reverse()
      .find((threshold) => hasReached(turnover, ceiling, threshold)) ?? null;
  const crossed = exceeded ? CEILING_EXCEEDED_PERCENT : crossedThreshold;
  const banner =
    !exceeded && crossedThreshold !== null && !acked.includes(crossedThreshold)
      ? crossedThreshold
      : null;
  return {
    state: "set",
    year,
    ceiling,
    turnover,
    percentTenths: Number((BigInt(turnover) * BigInt(1000)) / BigInt(ceiling)),
    remaining: Math.max(ceiling - turnover, 0),
    excess: Math.max(turnover - ceiling, 0),
    crossed,
    banner,
  };
}

/** 724 → "72.4%". */
export function formatCeilingPercent(percentTenths: number): string {
  return `${Math.trunc(percentTenths / 10)}.${percentTenths % 10}%`;
}

/** The value of the progress bar, out of PROGRESS_MAX (full at 100% and above). */
export const PROGRESS_MAX = 1000;

export function progressValue(percentTenths: number): number {
  return Math.min(percentTenths, PROGRESS_MAX);
}
