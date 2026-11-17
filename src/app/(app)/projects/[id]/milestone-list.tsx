"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { Button, buttonClasses } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ReceiptStatusBadge } from "@/components/receipt-status-badge";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { NO_ACTION_STATUS, type ActionStatus } from "@/lib/action-status";
import { callServerAction } from "@/lib/auth/action-failure";
import type { ReceiptStatus } from "@/lib/documents/status";
import {
  cancelMilestoneAction,
  deleteMilestoneAction,
  moveMilestoneAction,
  restoreMilestoneAction,
} from "@/lib/milestones/actions";
import { editMilestonePath } from "@/lib/milestones/paths";
import { moveTargetIndex, type MoveDirection } from "@/lib/milestones/reorder";
import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "@/lib/milestones/status";

/** A payment of a milestone as the card shows it, formatted on the server (MS-4, PRJ-3). */
export type MilestonePaymentItem = {
  id: string;
  /** DD/MM/YYYY. */
  receivedDate: string;
  /** Formatted amount. */
  amount: string;
  paymentMethod: string;
  editHref: string;
  /** INC-3. */
  receiptStatus: ReceiptStatus;
};

/** A milestone as the card shows it, formatted on the server. */
export type MilestoneListItem = {
  id: string;
  description: string;
  /** Formatted amount. */
  amount: string;
  /** DD/MM/YYYY. */
  dueDate: string;
  status: MilestoneStatus;
  /** Formatted amount paid so far. */
  paid: string;
  /** "יתרה: …" or "שולם ביתר: …". */
  balanceText: string;
  payments: readonly MilestonePaymentItem[];
  /** MS-4: "רשום תשלום", or null for a cancelled milestone (owner decision). */
  recordPaymentHref: string | null;
};

type MilestoneListProps = {
  projectId: string;
  items: readonly MilestoneListItem[];
  /** The section heading; focus goes there after a milestone is deleted. */
  headingId: string;
  /** Shown instead of the list when the project has no milestones (also after a delete). */
  emptyMessage: string;
};

type ActionKey = `${string}:${"up" | "down" | "cancel" | "restore" | "delete"}`;

const MOVE_LABELS: Record<MoveDirection, string> = { up: "למעלה", down: "למטה" };
const EDGE_MESSAGES: Record<MoveDirection, string> = {
  up: "אבן הדרך כבר ראשונה ברשימה.",
  down: "אבן הדרך כבר אחרונה ברשימה.",
};
const NOT_FOUND = "אבן הדרך לא נמצאה. ייתכן שנמחקה.";

function buttonId(milestoneId: string, action: "up" | "down" | "cancel" | "restore") {
  return `milestone-${milestoneId}-${action}`;
}

/**
 * MS-1 and the owner decisions on order, cancel and delete: the milestone list with
 * "למעלה"/"למטה", edit, cancel / un-cancel and delete. One action runs at a time; results
 * and failures are announced in the live region, and nothing is ever `disabled`, so focus is
 * never dropped:
 * - after a move, focus stays on the moved milestone's button, and the new place and the list
 *   length announced are the ones the database reports. On the current data the first item's
 *   "למעלה" and the last item's "למטה" are marked aria-disabled as a hint, but stay focusable
 *   and still ask the database, which answers "already first/last" when nothing can move;
 * - after cancel / un-cancel, focus moves to the counterpart button of the same milestone;
 * - after delete, focus moves to the section heading.
 *
 * The live region and the focus handling stay mounted when the list becomes empty (the last
 * milestone was deleted), so that delete is still announced and focus still moves.
 */
export function MilestoneList({ projectId, items, headingId, emptyMessage }: MilestoneListProps) {
  const [status, setStatus] = useState<ActionStatus>(NO_ACTION_STATUS);
  const [dialogError, setDialogError] = useState<{ key: ActionKey; error: string } | null>(null);
  const [busyKey, setBusyKey] = useState<ActionKey | null>(null);
  const [pending, start] = useGuardedTransition();
  /** Id of the element to focus once the list shows the action's result. */
  const focusTarget = useRef<string | null>(null);

  // The new list arrives with the Server Action's response (revalidatePath). Keep trying on
  // each render until the target exists and can take focus (not while a dialog that is
  // about to close still makes the page inert).
  useEffect(() => {
    const id = focusTarget.current;
    if (!id) {
      return;
    }
    const element = document.getElementById(id);
    element?.focus();
    if (element && document.activeElement === element) {
      focusTarget.current = null;
    }
  }, [items, status, pending]);

  function run(key: ActionKey, task: () => Promise<void>) {
    start(async () => {
      setBusyKey(key);
      setStatus(NO_ACTION_STATUS);
      setDialogError(null);
      await task();
      setBusyKey(null);
    });
  }

  /**
   * The database decides whether the milestone can move and where it ends up; the list on
   * screen may be out of date (another session may have changed the order), so it is not
   * consulted here. The aria-disabled edge buttons are a hint only and still ask.
   */
  function move(item: MilestoneListItem, direction: MoveDirection) {
    run(`${item.id}:${direction}`, async () => {
      const call = await callServerAction(() => moveMilestoneAction(item.id, direction));
      if (call.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
        return;
      }
      if (call.status === "redirected") {
        return;
      }
      const result = call.value;
      if (result.status === "failed") {
        setStatus({ message: null, error: result.error });
      } else if (result.status === "not_found") {
        setStatus({ message: null, error: NOT_FOUND });
      } else if (result.status === "edge") {
        setStatus({ message: EDGE_MESSAGES[direction], error: null });
      } else {
        focusTarget.current = buttonId(item.id, direction);
        setStatus({
          message: `"${item.description}" הועברה למקום ${result.place} מתוך ${result.total}.`,
          error: null,
        });
      }
    });
  }

  /** Cancel and delete run from a confirmation dialog; its errors are shown inside it. */
  function confirmed(key: ActionKey, action: () => Promise<ActionStatus>, focusAfter: string) {
    run(key, async () => {
      const call = await callServerAction(action);
      if (call.status === "failed") {
        setDialogError({ key, error: REQUEST_FAILED_MESSAGE });
      } else if (call.status === "done" && call.value.error) {
        setDialogError({ key, error: call.value.error });
      } else if (call.status === "done") {
        focusTarget.current = focusAfter;
        setStatus(call.value);
      }
    });
  }

  function restore(item: MilestoneListItem) {
    run(`${item.id}:restore`, async () => {
      const call = await callServerAction(() => restoreMilestoneAction(item.id));
      if (call.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
      } else if (call.status === "done") {
        if (!call.value.error) {
          focusTarget.current = buttonId(item.id, "cancel");
        }
        setStatus(call.value);
      }
    });
  }

  return (
    <>
      <p role="status" className="text-sm font-medium empty:sr-only">
        {status.message}
        {status.error ? <span className="text-destructive">{status.error}</span> : null}
      </p>
      {items.length === 0 ? <p className="text-muted-foreground">{emptyMessage}</p> : null}
      <ol aria-labelledby={headingId} className="divide-y rounded-lg border empty:hidden">
        {items.map((item, index) => {
          const isCancelled = item.status === "cancelled";
          return (
            <li key={item.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 font-medium wrap-anywhere">{item.description}</p>
                <span className="bg-muted inline-flex shrink-0 items-center rounded-full border px-3 py-0.5 text-sm">
                  {MILESTONE_STATUS_LABELS[item.status]}
                </span>
              </div>
              <p className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  סכום: <span className="text-foreground">{item.amount}</span>
                </span>
                <span>
                  תאריך יעד: <span className="text-foreground">{item.dueDate}</span>
                </span>
                <span>
                  שולם: <span className="text-foreground">{item.paid}</span>
                </span>
                <span className="text-foreground">{item.balanceText}</span>
              </p>
              {item.payments.length > 0 ? (
                <ul
                  aria-label={`תשלומים: ${item.description}`}
                  className="bg-muted/40 divide-y rounded-md border text-sm"
                >
                  {item.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1"
                    >
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>{payment.receivedDate}</span>
                        <span className="font-medium">{payment.amount}</span>
                        <span className="text-muted-foreground">{payment.paymentMethod}</span>
                        <ReceiptStatusBadge status={payment.receiptStatus} />
                      </span>
                      <Link
                        href={payment.editHref}
                        aria-label={`עריכת תשלום מ-${payment.receivedDate} על סך ${payment.amount}`}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
                      >
                        עריכה
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {item.recordPaymentHref ? (
                  <Link
                    href={item.recordPaymentHref}
                    aria-label={`רשום תשלום: ${item.description}`}
                    className={buttonClasses("secondary")}
                  >
                    רשום תשלום
                  </Link>
                ) : null}
                {(["up", "down"] as const).map((direction) => {
                  const key: ActionKey = `${item.id}:${direction}`;
                  const atEdge = moveTargetIndex(index, items.length, direction) === null;
                  const isBusy = pending && busyKey === key;
                  return (
                    <Button
                      key={direction}
                      id={buttonId(item.id, direction)}
                      variant="secondary"
                      onClick={() => move(item, direction)}
                      pending={isBusy}
                      aria-disabled={atEdge || isBusy || undefined}
                      aria-label={`${MOVE_LABELS[direction]}: ${item.description}`}
                    >
                      {MOVE_LABELS[direction]}
                    </Button>
                  );
                })}
                <Link
                  href={editMilestonePath(projectId, item.id)}
                  aria-label={`עריכה: ${item.description}`}
                  className={buttonClasses("secondary")}
                >
                  עריכה
                </Link>
                {isCancelled ? (
                  <Button
                    id={buttonId(item.id, "restore")}
                    variant="secondary"
                    onClick={() => restore(item)}
                    pending={pending && busyKey === `${item.id}:restore`}
                    aria-label={`החזרה מביטול: ${item.description}`}
                  >
                    {pending && busyKey === `${item.id}:restore` ? "מחזיר…" : "החזרה מביטול"}
                  </Button>
                ) : (
                  <ConfirmDialog
                    triggerLabel="ביטול אבן דרך"
                    triggerVariant="secondary"
                    triggerAriaLabel={`ביטול אבן דרך: ${item.description}`}
                    triggerId={buttonId(item.id, "cancel")}
                    title="לבטל את אבן הדרך?"
                    description={`אבן הדרך "${item.description}" תסומן כמבוטלת: היא לא תיכלל בסכום אבני הדרך ולא תופיע בחובות הפתוחים. אפשר להחזיר אותה מביטול בכל עת.`}
                    confirmLabel="ביטול אבן הדרך"
                    pendingLabel="מבטל…"
                    cancelLabel="חזרה"
                    onConfirm={() =>
                      confirmed(
                        `${item.id}:cancel`,
                        () => cancelMilestoneAction(item.id),
                        buttonId(item.id, "restore"),
                      )
                    }
                    pending={pending && busyKey === `${item.id}:cancel`}
                    error={dialogError?.key === `${item.id}:cancel` ? dialogError.error : null}
                  />
                )}
                <ConfirmDialog
                  triggerLabel="מחיקה"
                  triggerAriaLabel={`מחיקה: ${item.description}`}
                  title="למחוק את אבן הדרך לצמיתות?"
                  description={`אבן הדרך "${item.description}" תימחק ולא יהיה אפשר לשחזר אותה. כדי שלא תיגבה אבל תישאר ברשימה, אפשר לבטל אותה במקום.`}
                  confirmLabel="מחיקה לצמיתות"
                  pendingLabel="מוחק…"
                  cancelLabel="חזרה"
                  onConfirm={() =>
                    confirmed(`${item.id}:delete`, () => deleteMilestoneAction(item.id), headingId)
                  }
                  pending={pending && busyKey === `${item.id}:delete`}
                  error={dialogError?.key === `${item.id}:delete` ? dialogError.error : null}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
