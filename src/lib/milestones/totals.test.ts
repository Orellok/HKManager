import { describe, expect, it } from "vitest";

import { MAX_AGOROT } from "@/lib/money";

import { summarizeMilestoneTotals } from "./totals";

const active = (amount: number) => ({ amount, cancelled_at: null });
const cancelled = (amount: number) => ({ amount, cancelled_at: "2026-11-16T10:00:00Z" });

describe("summarizeMilestoneTotals", () => {
  it("MS-3: a sum equal to the contract amount matches", () => {
    expect(summarizeMilestoneTotals([active(300_000), active(700_000)], 1_000_000)).toEqual({
      total: 1_000_000,
      comparison: { kind: "matches" },
    });
  });

  it("MS-3: a sum above the contract amount warns with the difference", () => {
    expect(summarizeMilestoneTotals([active(600_000), active(500_001)], 1_000_000)).toEqual({
      total: 1_100_001,
      comparison: { kind: "above", difference: 100_001 },
    });
  });

  it("MS-3: a sum below the contract amount warns with the difference", () => {
    expect(summarizeMilestoneTotals([active(1)], 1_000_000)).toEqual({
      total: 1,
      comparison: { kind: "below", difference: 999_999 },
    });
  });

  it("MS-3: cancelled milestones are not counted", () => {
    expect(summarizeMilestoneTotals([active(1_000_000), cancelled(500_000)], 1_000_000)).toEqual({
      total: 1_000_000,
      comparison: { kind: "matches" },
    });
  });

  it("MS-3: without a contract amount there is no comparison, only the total", () => {
    expect(summarizeMilestoneTotals([active(250_050)], null)).toEqual({
      total: 250_050,
      comparison: { kind: "no_contract" },
    });
  });

  it("MS-3: a contract amount of 0 is compared like any other", () => {
    expect(summarizeMilestoneTotals([active(0)], 0).comparison).toEqual({ kind: "matches" });
    expect(summarizeMilestoneTotals([active(1)], 0).comparison).toEqual({
      kind: "above",
      difference: 1,
    });
  });

  it("MS-3: no milestones (or only cancelled ones) sum to 0", () => {
    expect(summarizeMilestoneTotals([], 1_000)).toEqual({
      total: 0,
      comparison: { kind: "below", difference: 1_000 },
    });
    expect(summarizeMilestoneTotals([cancelled(1_000)], 1_000).total).toBe(0);
  });

  it("MS-3: 100 milestones of the maximum amount sum exactly in integer agorot", () => {
    const milestones = Array.from({ length: 100 }, () => active(MAX_AGOROT));

    const { total, comparison } = summarizeMilestoneTotals(milestones, MAX_AGOROT);

    expect(total).toBe(999_999_999_900);
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(comparison).toEqual({ kind: "above", difference: 989_999_999_901 });
  });
});
