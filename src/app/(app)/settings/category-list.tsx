"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { Button, buttonClasses } from "@/components/button";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { NO_ACTION_STATUS, type ActionStatus } from "@/lib/action-status";
import { callServerAction } from "@/lib/auth/action-failure";
import {
  archiveCategoryAction,
  moveCategoryAction,
  restoreCategoryAction,
} from "@/lib/expense-categories/actions";
import { editCategoryPath } from "@/lib/expense-categories/paths";
import type { ExpenseCategory } from "@/lib/expense-categories/queries";
import { moveTargetIndex, type MoveDirection } from "@/lib/milestones/reorder";

type CategoryAction = MoveDirection | "archive" | "restore";
type ActionKey = `${string}:${CategoryAction}`;

const MOVE_LABELS: Record<MoveDirection, string> = { up: "למעלה", down: "למטה" };
const EDGE_MESSAGES: Record<MoveDirection, string> = {
  up: "הקטגוריה כבר ראשונה ברשימה.",
  down: "הקטגוריה כבר אחרונה ברשימה.",
};
const NOT_FOUND = "הקטגוריה לא נמצאה או שהועברה לארכיון. הרשימה עודכנה.";

function buttonId(categoryId: string, action: CategoryAction) {
  return `category-${categoryId}-${action}`;
}

/**
 * EXP-3 / owner decision (M3): the active categories in order, with "למעלה"/"למטה", rename
 * and archive, then the archived ones with rename and restore. One action runs at a time;
 * results and failures are announced in the live region, and no button is ever `disabled`,
 * so focus is never dropped:
 * - after a move, focus stays on the moved category's button; the place announced is the
 *   one the database reports. The first "למעלה" and the last "למטה" are marked
 *   aria-disabled as a hint, but still ask the database;
 * - after archive, focus moves to the category's "החזרה מהארכיון", and back after restore.
 */
export function CategoryList({ categories }: { categories: readonly ExpenseCategory[] }) {
  const [status, setStatus] = useState<ActionStatus>(NO_ACTION_STATUS);
  const [busyKey, setBusyKey] = useState<ActionKey | null>(null);
  const [pending, start] = useGuardedTransition();
  /** Id of the element to focus once the list shows the action's result. */
  const focusTarget = useRef<string | null>(null);
  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  // The new list arrives with the Server Action's response (revalidatePath); keep trying on
  // each render until the target exists.
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
  }, [categories, status, pending]);

  function run(key: ActionKey, task: () => Promise<void>) {
    start(async () => {
      setBusyKey(key);
      setStatus(NO_ACTION_STATUS);
      await task();
      setBusyKey(null);
    });
  }

  function move(category: ExpenseCategory, direction: MoveDirection) {
    run(`${category.id}:${direction}`, async () => {
      const call = await callServerAction(() => moveCategoryAction(category.id, direction));
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
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
        focusTarget.current = buttonId(category.id, direction);
        setStatus({
          message: `"${category.name}" הועברה למקום ${result.place} מתוך ${result.total}.`,
          error: null,
        });
      }
    });
  }

  function setArchived(category: ExpenseCategory, archive: boolean) {
    run(`${category.id}:${archive ? "archive" : "restore"}`, async () => {
      const call = await callServerAction(() =>
        archive ? archiveCategoryAction(category.id) : restoreCategoryAction(category.id),
      );
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
        return;
      }
      if (!call.value.error) {
        focusTarget.current = buttonId(category.id, archive ? "restore" : "archive");
      }
      setStatus(call.value);
    });
  }

  const isBusy = (category: ExpenseCategory, action: CategoryAction) =>
    pending && busyKey === `${category.id}:${action}`;

  return (
    <div className="space-y-4">
      <p role="status" className="text-sm font-medium empty:sr-only">
        {status.message}
        {status.error ? <span className="text-destructive">{status.error}</span> : null}
      </p>

      {active.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border p-4">
          אין קטגוריות פעילות. אפשר להוסיף קטגוריה או להחזיר אחת מהארכיון.
        </p>
      ) : (
        <ol aria-label="קטגוריות פעילות" className="divide-y rounded-lg border">
          {active.map((category, index) => (
            <li
              key={category.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3"
            >
              <span className="min-w-0 font-medium wrap-anywhere">{category.name}</span>
              <span className="flex flex-wrap gap-2">
                {(["up", "down"] as const).map((direction) => {
                  const atEdge = moveTargetIndex(index, active.length, direction) === null;
                  const busy = isBusy(category, direction);
                  return (
                    <Button
                      key={direction}
                      id={buttonId(category.id, direction)}
                      variant="secondary"
                      onClick={() => move(category, direction)}
                      pending={busy}
                      aria-disabled={atEdge || busy || undefined}
                      aria-label={`${MOVE_LABELS[direction]}: ${category.name}`}
                    >
                      {MOVE_LABELS[direction]}
                    </Button>
                  );
                })}
                <Link
                  href={editCategoryPath(category.id)}
                  aria-label={`שינוי שם: ${category.name}`}
                  className={buttonClasses("secondary")}
                >
                  שינוי שם
                </Link>
                <Button
                  id={buttonId(category.id, "archive")}
                  variant="secondary"
                  onClick={() => setArchived(category, true)}
                  pending={isBusy(category, "archive")}
                  aria-label={`העברה לארכיון: ${category.name}`}
                >
                  העברה לארכיון
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {archived.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">בארכיון</h3>
          <ul aria-label="קטגוריות בארכיון" className="divide-y rounded-lg border">
            {archived.map((category) => (
              <li
                key={category.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3"
              >
                <span className="text-muted-foreground min-w-0 wrap-anywhere">{category.name}</span>
                <span className="flex flex-wrap gap-2">
                  <Link
                    href={editCategoryPath(category.id)}
                    aria-label={`שינוי שם: ${category.name}`}
                    className={buttonClasses("secondary")}
                  >
                    שינוי שם
                  </Link>
                  <Button
                    id={buttonId(category.id, "restore")}
                    variant="secondary"
                    onClick={() => setArchived(category, false)}
                    pending={isBusy(category, "restore")}
                    aria-label={`החזרה מהארכיון: ${category.name}`}
                  >
                    החזרה מהארכיון
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
