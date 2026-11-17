import { describe, expect, it } from "vitest";

import { MAX_AGOROT } from "@/lib/money";

import { projectBalance, summarizeMilestonePayments, summarizeMilestoneTotals } from "./totals";

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

describe("summarizeMilestonePayments", () => {
  const CANCELLED_AT = "2026-11-10T10:00:00Z";

  it("MS-2: sums what was paid and the positive balances left", () => {
    expect(
      summarizeMilestonePayments([
        { paid: 0, balance: 100_000, cancelled_at: null },
        { paid: 40_000, balance: 60_000, cancelled_at: null },
        { paid: 50_000, balance: 0, cancelled_at: null },
      ]),
    ).toEqual({ paid: 90_000, openBalance: 160_000 });
  });

  it("MS-2 / MS-5: an overpaid milestone does not reduce another one's balance", () => {
    expect(
      summarizeMilestonePayments([
        { paid: 150_000, balance: -50_000, cancelled_at: null },
        { paid: 0, balance: 30_000, cancelled_at: null },
      ]),
    ).toEqual({ paid: 150_000, openBalance: 30_000 });
  });

  it("MS-2: a cancelled milestone's payments count as paid; its balance is not owed", () => {
    expect(
      summarizeMilestonePayments([{ paid: 10_000, balance: 90_000, cancelled_at: CANCELLED_AT }]),
    ).toEqual({ paid: 10_000, openBalance: 0 });
  });

  it("MS-2: no milestones sum to 0", () => {
    expect(summarizeMilestonePayments([])).toEqual({ paid: 0, openBalance: 0 });
  });
});

describe("projectBalance", () => {
  it("PRJ-3: without a contract amount there is no balance", () => {
    expect(projectBalance(null, 50_000)).toEqual({ kind: "no_contract" });
  });

  it("PRJ-3: the balance is the contract amount minus what was paid", () => {
    expect(projectBalance(1_000_000, 250_050)).toEqual({ kind: "open", balance: 749_950 });
  });

  it("PRJ-3: paid in full leaves a balance of 0", () => {
    expect(projectBalance(1_000_000, 1_000_000)).toEqual({ kind: "open", balance: 0 });
  });

  it("PRJ-3: more paid than the contract is an excess, not a negative balance", () => {
    expect(projectBalance(100_000, 150_001)).toEqual({ kind: "overpaid", excess: 50_001 });
  });

  it("PRJ-3: large sums stay exact in integer agorot", () => {
    expect(projectBalance(MAX_AGOROT, 999_999_999_900)).toEqual({
      kind: "overpaid",
      excess: 989_999_999_901,
    });
  });
});
