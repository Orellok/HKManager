import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { formatIsoDate } from "@/lib/dates";
import { newMilestonePath } from "@/lib/milestones/paths";
import type { Milestone } from "@/lib/milestones/queries";
import { milestoneStatus } from "@/lib/milestones/status";
import { summarizeMilestoneTotals, type MilestoneTotals } from "@/lib/milestones/totals";
import { formatAgorot } from "@/lib/money";

import { MilestoneList, type MilestoneListItem } from "./milestone-list";

type ProjectMilestonesProps = {
  projectId: string;
  /** Agorot, or null when not set. */
  contractAmount: number | null;
  milestones: readonly Milestone[];
  /** Today in Asia/Jerusalem (todayInJerusalem on the server). */
  today: string;
};

export const MILESTONES_HEADING_ID = "milestones-heading";

/**
 * MS-1..3: the project's milestones on the project card: the list in its order with each
 * one's computed status, the total of the non-cancelled ones compared with the contract
 * amount (a warning only), and "אבן דרך חדשה".
 */
export function ProjectMilestones({
  projectId,
  contractAmount,
  milestones,
  today,
}: ProjectMilestonesProps) {
  const items: MilestoneListItem[] = milestones.map((milestone) => ({
    id: milestone.id,
    description: milestone.description,
    amount: formatAgorot(milestone.amount),
    dueDate: formatIsoDate(milestone.due_date),
    status: milestoneStatus(milestone, today),
  }));

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

      {items.length === 0 ? (
        <p className="text-muted-foreground">
          אין עדיין אבני דרך לפרויקט. אבני דרך הן התשלומים שהלקוח צריך לשלם, לפי סדר ותאריך יעד.
        </p>
      ) : (
        <>
          <TotalsSummary
            totals={summarizeMilestoneTotals(milestones, contractAmount)}
            contractAmount={contractAmount}
          />
          <MilestoneList projectId={projectId} items={items} headingId={MILESTONES_HEADING_ID} />
        </>
      )}
    </section>
  );
}

function TotalsSummary({
  totals: { total, comparison },
  contractAmount,
}: {
  totals: MilestoneTotals;
  contractAmount: number | null;
}) {
  const totalText = `סה״כ אבני הדרך (בלי אבני דרך שבוטלו): ${formatAgorot(total)}`;
  if (comparison.kind === "no_contract" || contractAmount === null) {
    return (
      <p className="text-sm">
        {totalText}. <span className="text-muted-foreground">לא הוזן סכום חוזה להשוואה.</span>
      </p>
    );
  }
  if (comparison.kind === "matches") {
    return <p className="text-sm">{totalText}, שווה לסכום החוזה.</p>;
  }
  const direction = comparison.kind === "above" ? "גבוה" : "נמוך";
  const warning = `סכום אבני הדרך (${formatAgorot(total)}) ${direction} מסכום החוזה (${formatAgorot(contractAmount)}) ב-${formatAgorot(comparison.difference)}.`;
  // MS-3: a warning, not a block. Marked with text ("שימו לב") and a heavier border, not color.
  return (
    <p className="bg-muted rounded-md border-2 border-current p-3 text-sm">
      <strong>שימו לב:</strong> {warning}
    </p>
  );
}
