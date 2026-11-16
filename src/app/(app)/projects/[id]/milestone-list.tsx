"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { Button, buttonClasses } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { NO_ACTION_STATUS, type ActionStatus } from "@/lib/action-status";
import { callServerAction } from "@/lib/auth/action-failure";
import {
  cancelMilestoneAction,
  deleteMilestoneAction,
  moveMilestoneAction,
  restoreMilestoneAction,
} from "@/lib/milestones/actions";
import { editMilestonePath } from "@/lib/milestones/paths";
import { moveTargetIndex, type MoveDirection } from "@/lib/milestones/reorder";
import { MILESTONE_STATUS_LABELS, type MilestoneStatus } from "@/lib/milestones/status";

/** A milestone as the card shows it, formatted on the server. */
export type MilestoneListItem = {
  id: string;
  description: string;
  /** Formatted amount. */
  amount: string;
  /** DD/MM/YYYY. */
  dueDate: string;
  status: MilestoneStatus;
};

type MilestoneListProps = {
  projectId: string;
  items: readonly MilestoneListItem[];
  /** The section heading; focus goes there after a milestone is deleted. */
  headingId: string;
};

type ActionKey = `${string}:${"up" | "down" | "cancel" | "restore" | "delete"}`;

const MOVE_LABELS: Record<MoveDirection, string> = { up: "למעלה", down: "למטה" };
const EDGE_MESSAGES: Record<MoveDirection, string> = {
  up: "אבן הדרך כבר ראשונה ברשימה.",
  down: "אבן הדרך כבר אחרונה ברשימה.",
};
const MOVE_OUTDATED = "הסדר השתנה בינתיים. הרשימה עודכנה.";
const NOT_FOUND = "אבן הדרך לא נמצאה. ייתכן שנמחקה.";

function buttonId(milestoneId: string, action: "up" | "down" | "cancel" | "restore") {
  return `milestone-${milestoneId}-${action}`;
}

/**
 * MS-1 and the owner decisions on order, cancel and delete: the milestone list with
 * "למעלה"/"למטה", edit, cancel / un-cancel and delete. One action runs at a time; results
 * and failures are announced in the live region, and nothing is ever `disabled`, so focus is
 * never dropped:
 * - after a move, focus stays on the moved milestone's button. At the top or bottom edge the
 *   button stays focusable but is marked aria-disabled, sends nothing and announces that the
 *   milestone is already first or last;
 * - after cancel / un-cancel, focus moves to the counterpart button of the same milestone;
 * - after delete, focus moves to the section heading.
 */
export function MilestoneList({ projectId, items, headingId }: MilestoneListProps) {
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

  function move(index: number, direction: MoveDirection) {
    const item = items[index];
    const target = moveTargetIndex(index, items.length, direction);
    if (target === null) {
      setStatus({ message: EDGE_MESSAGES[direction], error: null });
      return;
    }
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
      } else if (result.status === "moved") {
        focusTarget.current = buttonId(item.id, direction);
        setStatus({
          message: `"${item.description}" הועברה למקום ${target + 1} מתוך ${items.length}.`,
          error: null,
        });
      } else {
        setStatus({ message: null, error: result.status === "edge" ? MOVE_OUTDATED : NOT_FOUND });
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
      <ol aria-labelledby={headingId} className="divide-y rounded-lg border">
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
              </p>
              <div className="flex flex-wrap gap-2">
                {(["up", "down"] as const).map((direction) => {
                  const key: ActionKey = `${item.id}:${direction}`;
                  const atEdge = moveTargetIndex(index, items.length, direction) === null;
                  const isBusy = pending && busyKey === key;
                  return (
                    <Button
                      key={direction}
                      id={buttonId(item.id, direction)}
                      variant="secondary"
                      onClick={() => move(index, direction)}
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
