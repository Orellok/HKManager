/**
 * MS-2: a milestone's status is computed, never stored. Every screen gets it from
 * milestoneStatus(), with "today" from todayInJerusalem() on the server.
 *
 * M1.3 has no incomes, so `paid` is always 0 (milestone_balances view). M2 adds
 * "partially_paid" and "paid" here, from the same inputs: callers pass a row of the view and
 * today, and keep working unchanged.
 */
export const MILESTONE_STATUSES = ["planned", "due", "cancelled"] as const;

export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  planned: "מתוכנן",
  due: "לתשלום",
  cancelled: "בוטל",
};

export type MilestoneStatusInput = {
  /** ISO date. */
  due_date: string;
  cancelled_at: string | null;
  /** Agorot still to pay (amount − paid). */
  balance: number;
};

/**
 * `cancelled` when cancelled; `due` when the due date is before today and something is left
 * to pay; otherwise `planned`. A due date of today is not overdue yet. ISO dates compare
 * correctly as strings.
 */
export function milestoneStatus(milestone: MilestoneStatusInput, today: string): MilestoneStatus {
  if (milestone.cancelled_at !== null) {
    return "cancelled";
  }
  if (milestone.due_date < today && milestone.balance > 0) {
    return "due";
  }
  return "planned";
}
