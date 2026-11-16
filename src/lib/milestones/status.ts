/**
 * MS-2: a milestone's status is computed, never stored. Every screen gets it from
 * milestoneStatus(), with "today" from todayInJerusalem() on the server and paid and balance
 * from the milestone_balances view (paid = the milestone's incomes that are not deleted).
 */
export const MILESTONE_STATUSES = [
  "planned",
  "due",
  "partially_paid",
  "paid",
  "cancelled",
] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "מתוכנן",
  due: "לתשלום",
  partially_paid: "שולם חלקית",
  paid: "שולם",
  cancelled: "בוטל",
};

export type MilestoneStatusInput = {
  /** ISO date. */
  due_date: string;
  cancelled_at: string | null;
  /** Agorot paid so far. */
  paid: number;
  /** Agorot still to pay (amount − paid); negative when overpaid. */
  balance: number;
};

/**
 * In this order: `cancelled` when cancelled; `paid` when something was paid and nothing is
 * left (also when overpaid); `due` when the due date is before today and something is left
 * to pay, also after a partial payment, because the remaining balance is overdue;
 * `partially_paid` when part was paid and the due date has not passed; otherwise `planned`
 * (nothing paid yet and not overdue, which includes an amount of 0). A due date of today is
 * not overdue yet. ISO dates compare correctly as strings.
 */
export function milestoneStatus(milestone: MilestoneStatusInput, today: string): MilestoneStatus {
  if (milestone.cancelled_at !== null) {
    return "cancelled";
  }
  if (milestone.paid > 0 && milestone.balance <= 0) {
    return "paid";
  }
  if (milestone.due_date < today && milestone.balance > 0) {
    return "due";
  }
  if (milestone.paid > 0) {
    return "partially_paid";
  }
  return "planned";
}
