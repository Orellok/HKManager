import { describe, expect, it } from "vitest";

import {
  ceilingAckedMessage,
  ceilingNotCrossedMessage,
  ceilingStatus,
  formatCeilingPercent,
  hasReached,
  isCeilingThreshold,
  progressValue,
} from "./status";

const CEILING_2026 = 12_283_300;

function statusAt(turnover: number, acked: number[] = [], ceiling: number | null = 1_000_000) {
  return ceilingStatus({ year: 2026, ceiling, turnover, acked });
}

describe("CEIL-3..6: ceiling status", () => {
  it("CEIL-3: turnover, percentage and what is left", () => {
    const status = statusAt(699_900);
    expect(status).toMatchObject({
      state: "set",
      ceiling: 1_000_000,
      turnover: 699_900,
      percentTenths: 699,
      remaining: 300_100,
      excess: 0,
      crossed: null,
      banner: null,
    });
  });

  it.each([
    [699_999, null, null],
    [700_000, 70, 70],
    [849_999, 70, 70],
    [850_000, 85, 85],
    [949_999, 85, 85],
    [950_000, 95, 95],
    [999_999, 95, 95],
    [1_000_000, 100, null],
    [5_000_000, 100, null],
  ])(
    "CEIL-4/5: at %i agorot the crossed threshold is %s and the banner %s",
    (turnover, crossed, banner) => {
      expect(statusAt(turnover)).toMatchObject({ crossed, banner });
    },
  );

  it("CEIL-4: an acknowledged threshold shows no banner; a higher one shows its own", () => {
    expect(statusAt(800_000, [70])).toMatchObject({ crossed: 70, banner: null });
    expect(statusAt(900_000, [70])).toMatchObject({ crossed: 85, banner: 85 });
    expect(statusAt(900_000, [70, 85])).toMatchObject({ banner: null });
    // Jumping past several thresholds: one banner, the highest.
    expect(statusAt(960_000, [])).toMatchObject({ banner: 95 });
  });

  it("CEIL-5: at and above 100% the threshold banners give way, whatever was acknowledged", () => {
    expect(statusAt(1_000_000, [])).toMatchObject({ crossed: 100, banner: null, remaining: 0 });
    expect(statusAt(1_050_000, [70, 85, 95])).toMatchObject({
      crossed: 100,
      banner: null,
      remaining: 0,
      excess: 50_000,
      percentTenths: 1050,
    });
  });

  it("CEIL-6: a year without a ceiling has no numbers of a ceiling", () => {
    expect(statusAt(12_345, [], null)).toEqual({ state: "not_set", year: 2026, turnover: 12_345 });
  });

  it("CEIL-3: the 2026 ceiling and large amounts are exact (no floating point)", () => {
    // 70% of 12,283,300 is 8,598,310 exactly.
    expect(hasReached(8_598_309, CEILING_2026, 70)).toBe(false);
    expect(hasReached(8_598_310, CEILING_2026, 70)).toBe(true);
    // 0.7 * x in floating point is not exact for many values; BigInt is.
    expect(hasReached(7, 10, 70)).toBe(true);
    expect(hasReached(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 100)).toBe(true);
    expect(hasReached(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, 100)).toBe(false);
  });

  it("CEIL-3: the display percentage is truncated, so 69.99% never reads 70.0%", () => {
    expect(formatCeilingPercent(statusAt(699_999).state === "set" ? 699 : 0)).toBe("69.9%");
    expect(formatCeilingPercent(1000)).toBe("100.0%");
    expect(formatCeilingPercent(5)).toBe("0.5%");
    expect(progressValue(724)).toBe(724);
    expect(progressValue(1500)).toBe(1000);
  });

  it("CEIL-4: only 70, 85 and 95 can be acknowledged", () => {
    expect([70, 85, 95].every(isCeilingThreshold)).toBe(true);
    expect([0, 69, 100, "70", null].some(isCeilingThreshold)).toBe(false);
  });

  it("CEIL-3: rejects amounts the database cannot have produced", () => {
    expect(() => statusAt(-1)).toThrow(RangeError);
    expect(() => statusAt(1.5)).toThrow(RangeError);
    expect(() => statusAt(1, [], 0)).toThrow(RangeError);
  });
});

describe("CEIL-4: acknowledgement messages (M4.1 carry-over)", () => {
  it.each([
    [
      70,
      "ההתראה אושרה: התראת 70% לא תוצג שוב בשנת 2026. התראה חדשה תוצג אם המחזור יעבור 85% מהתקרה.",
    ],
    [
      85,
      "ההתראה אושרה: התראת 85% לא תוצג שוב בשנת 2026. התראה חדשה תוצג אם המחזור יעבור 95% מהתקרה.",
    ],
    [
      95,
      "ההתראה אושרה: התראת 95% לא תוצג שוב בשנת 2026. אם המחזור יגיע לתקרה (100%) תוצג התראה קבועה.",
    ],
  ] as const)("CEIL-4: acknowledging %i%% says what still shows", (threshold, message) => {
    expect(ceilingAckedMessage(2026, threshold)).toBe(message);
  });

  it("CEIL-4: names the year of the acknowledged banner, not the current one", () => {
    expect(ceilingAckedMessage(2031, 70)).toContain("בשנת 2031");
  });

  it("CEIL-4: a refused acknowledgement names the year and threshold", () => {
    expect(ceilingNotCrossedMessage(2026, 85)).toBe(
      "ההתראה לא אושרה: המחזור בשנת 2026 לא הגיע ל-85% מהתקרה. הנתונים בדף עודכנו.",
    );
  });
});
