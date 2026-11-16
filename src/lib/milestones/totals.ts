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

export type MilestonePayment = { paid: number; balance: number; cancelled_at: string | null };

export type MilestonePaymentTotals = {
  /** Agorot paid on the project's milestones, cancelled ones included (money received). */
  paid: number;
  /**
   * Agorot still to pay: the positive balances of the non-cancelled milestones. An overpaid
   * milestone does not reduce another milestone's balance.
   */
  openBalance: number;
};

/** MS-2 / PRJ-3: what was paid on a project's milestones and what is left to pay. */
export function summarizeMilestonePayments(
  milestones: readonly MilestonePayment[],
): MilestonePaymentTotals {
  let paid = 0;
  let openBalance = 0;
  for (const milestone of milestones) {
    paid += milestone.paid;
    if (milestone.cancelled_at === null && milestone.balance > 0) {
      openBalance += milestone.balance;
    }
  }
  return { paid, openBalance };
}

export type ProjectBalance =
  | { kind: "no_contract" }
  | { kind: "open"; balance: number }
  | { kind: "overpaid"; excess: number };

/**
 * PRJ-3: the project's balance, contract amount − paid, when a contract amount is set.
 * More paid than the contract is shown as an excess, never as a negative amount.
 */
export function projectBalance(contractAmount: number | null, paid: number): ProjectBalance {
  if (contractAmount === null) {
    return { kind: "no_contract" };
  }
  const balance = contractAmount - paid;
  return balance >= 0 ? { kind: "open", balance } : { kind: "overpaid", excess: -balance };
}
