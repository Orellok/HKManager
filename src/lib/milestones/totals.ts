/**
 * MS-3: the sum of a project's non-cancelled milestones compared with its contract amount.
 * A difference is a warning only, never a block. All amounts are integer agorot.
 */

export type MilestoneAmount = { amount: number; cancelled_at: string | null };

export type MilestoneTotals = {
  /** Sum of the non-cancelled milestones, in agorot. */
  total: number;
  comparison:
    | { kind: "no_contract" }
    | { kind: "matches" }
    | { kind: "above"; difference: number }
    | { kind: "below"; difference: number };
};

export function summarizeMilestoneTotals(
  milestones: readonly MilestoneAmount[],
  contractAmount: number | null,
): MilestoneTotals {
  // At most 100 milestones of at most MAX_AGOROT each: far below Number.MAX_SAFE_INTEGER.
  const total = milestones
    .filter((milestone) => milestone.cancelled_at === null)
    .reduce((sum, milestone) => sum + milestone.amount, 0);
  if (contractAmount === null) {
    return { total, comparison: { kind: "no_contract" } };
  }
  if (total === contractAmount) {
    return { total, comparison: { kind: "matches" } };
  }
  return total > contractAmount
    ? { total, comparison: { kind: "above", difference: total - contractAmount } }
    : { total, comparison: { kind: "below", difference: contractAmount - total } };
}
