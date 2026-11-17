import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { formatIsoDate } from "@/lib/dates";
import { editIncomePath, recordPaymentPath } from "@/lib/incomes/paths";
import { PAYMENT_METHOD_LABELS } from "@/lib/incomes/payment-methods";
import type { ProjectIncome } from "@/lib/incomes/queries";
import { newMilestonePath } from "@/lib/milestones/paths";
import type { Milestone } from "@/lib/milestones/queries";
import { milestoneStatus } from "@/lib/milestones/status";
import {
  summarizeMilestonePayments,
  summarizeMilestoneTotals,
  type MilestonePaymentTotals,
  type MilestoneTotals,
} from "@/lib/milestones/totals";
import { formatAgorot } from "@/lib/money";

import { MilestoneList, type MilestoneListItem, type MilestonePaymentItem } from "./milestone-list";

type ProjectMilestonesProps = {
  projectId: string;
  /** Agorot, or null when not set. */
  contractAmount: number | null;
  milestones: readonly Milestone[];
  /** The project's incomes that have a milestone, oldest first. */
  incomes: readonly ProjectIncome[];
  /** Today in Asia/Jerusalem (todayInJerusalem on the server). */
  today: string;
};

export const MILESTONES_HEADING_ID = "milestones-heading";

const EMPTY_MESSAGE =
  "אין עדיין אבני דרך לפרויקט. אבני דרך הן התשלומים שהלקוח צריך לשלם, לפי סדר ותאריך יעד.";

/** "יתרה: …", or "שולם ביתר: …" for an overpaid milestone (MS-5), never a negative amount. */
export function balanceText(balance: number): string {
  return balance < 0 ? `שולם ביתר: ${formatAgorot(-balance)}` : `יתרה: ${formatAgorot(balance)}`;
}

/** A payment as the project card lists it. */
export function toPaymentItem(income: ProjectIncome): MilestonePaymentItem {
  return {
    id: income.id,
    receivedDate: formatIsoDate(income.received_date),
    amount: formatAgorot(income.amount),
    paymentMethod: PAYMENT_METHOD_LABELS[income.payment_method],
    editHref: editIncomePath(income.id, "project"),
  };
}

/**
 * MS-1..5 and PRJ-3: the project's milestones on the project card: the list in its order
 * with each one's computed status, what was paid and what is left, its payments and "רשום
 * תשלום"; the total of the non-cancelled ones compared with the contract amount (a warning
 * only), and "אבן דרך חדשה".
 */
export function ProjectMilestones({
  projectId,
  contractAmount,
  milestones,
  incomes,
  today,
}: ProjectMilestonesProps) {
  const paymentsByMilestone = Map.groupBy(incomes, (income) => income.milestone_id);
  const items: MilestoneListItem[] = milestones.map((milestone) => {
    const status = milestoneStatus(milestone, today);
    return {
      id: milestone.id,
      description: milestone.description,
      amount: formatAgorot(milestone.amount),
      dueDate: formatIsoDate(milestone.due_date),
      status,
      paid: formatAgorot(milestone.paid),
      balanceText: balanceText(milestone.balance),
      payments: (paymentsByMilestone.get(milestone.id) ?? []).map(toPaymentItem),
      recordPaymentHref: status === "cancelled" ? null : recordPaymentPath(milestone.id),
    };
  });

  return (
    <section aria-labelledby={MILESTONES_HEADING_ID} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Focusable by script: focus lands here after a milestone is deleted. */}
        <h2 id={MILESTONES_HEADING_ID} tabIndex={-1} className="text-xl font-semibold">
          אבני דרך
        </h2>
        <Link href={newMilestonePath(projectId)} className={buttonClasses("secondary")}>
          אבן דרך חדשה
        </Link>
      </div>

      {items.length > 0 ? (
        <TotalsSummary
          totals={summarizeMilestoneTotals(milestones, contractAmount)}
          payments={summarizeMilestonePayments(milestones)}
          contractAmount={contractAmount}
        />
      ) : null}
      {/* Mounted also without milestones, so deleting the last one is announced. */}
      <MilestoneList
        projectId={projectId}
        items={items}
        headingId={MILESTONES_HEADING_ID}
        emptyMessage={EMPTY_MESSAGE}
      />
    </section>
  );
}

function TotalsSummary({
  totals: { total, comparison },
  payments,
  contractAmount,
}: {
  totals: MilestoneTotals;
  payments: MilestonePaymentTotals;
  contractAmount: number | null;
}) {
  const paymentsText = (
    <p className="text-sm">
      שולם על אבני הדרך: {formatAgorot(payments.paid)}. נותר לתשלום באבני הדרך:{" "}
      {formatAgorot(payments.openBalance)}.
    </p>
  );
  const totalText = `סה״כ אבני הדרך (בלי אבני דרך שבוטלו): ${formatAgorot(total)}`;
  if (comparison.kind === "no_contract" || contractAmount === null) {
    return (
      <>
        <p className="text-sm">
          {totalText}. <span className="text-muted-foreground">לא הוזן סכום חוזה להשוואה.</span>
        </p>
        {paymentsText}
      </>
    );
  }
  if (comparison.kind === "matches") {
    return (
      <>
        <p className="text-sm">{totalText}, שווה לסכום החוזה.</p>
        {paymentsText}
      </>
    );
  }
  const direction = comparison.kind === "above" ? "גבוה" : "נמוך";
  const warning = `סכום אבני הדרך (${formatAgorot(total)}) ${direction} מסכום החוזה (${formatAgorot(contractAmount)}) ב-${formatAgorot(comparison.difference)}.`;
  // MS-3: a warning, not a block. Marked with text ("שימו לב") and a heavier border, not color.
  return (
    <>
      <p className="bg-muted rounded-md border-2 border-current p-3 text-sm">
        <strong>שימו לב:</strong> {warning}
      </p>
      {paymentsText}
    </>
  );
}
