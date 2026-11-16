"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { NO_ACTION_STATUS, type ActionStatus } from "@/lib/action-status";
import { callServerAction } from "@/lib/auth/action-failure";

export const REQUEST_FAILED_MESSAGE = "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב.";

type ArchiveDeleteActionsProps = {
  isArchived: boolean;
  onArchive: () => Promise<ActionStatus>;
  onRestore: () => Promise<ActionStatus>;
  /** Redirects on success; returns only on failure. */
  onDelete: () => Promise<ActionStatus>;
  deleteTitle: string;
  deleteDescription: string;
};

function archiveButtonLabel(isArchived: boolean, pending: boolean): string {
  if (isArchived) {
    return pending ? "מחזיר מהארכיון…" : "שחזור מהארכיון";
  }
  return pending ? "מעביר לארכיון…" : "העברה לארכיון";
}

/**
 * Archive / restore, and permanent delete behind a confirmation dialog, for a record card
 * (clients, projects). Results are announced in a live region; a failed request shows an
 * inline error and changes nothing; an ended session goes to /login.
 */
export function ArchiveDeleteActions({
  isArchived,
  onArchive,
  onRestore,
  onDelete,
  deleteTitle,
  deleteDescription,
}: ArchiveDeleteActionsProps) {
  const [status, setStatus] = useState<ActionStatus>(NO_ACTION_STATUS);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [archivePending, startArchive] = useGuardedTransition();
  const [deletePending, startDelete] = useGuardedTransition();

  // The archive button stays mounted and focused (it is never `disabled`), so after the
  // action keyboard focus is on its counterpart: "שחזור מהארכיון" after archiving.
  function toggleArchive() {
    startArchive(async () => {
      setStatus(NO_ACTION_STATUS);
      const result = await callServerAction(isArchived ? onRestore : onArchive);
      if (result.status === "done") {
        setStatus(result.value);
      } else if (result.status === "failed") {
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
      }
    });
  }

  function confirmDelete() {
    startDelete(async () => {
      setDeleteError(null);
      const result = await callServerAction(onDelete);
      if (result.status === "done") {
        setDeleteError(result.value.error);
      } else if (result.status === "failed") {
        setDeleteError(REQUEST_FAILED_MESSAGE);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={toggleArchive} pending={archivePending}>
        {archiveButtonLabel(isArchived, archivePending)}
      </Button>
      <ConfirmDialog
        triggerLabel="מחיקה לצמיתות"
        title={deleteTitle}
        description={deleteDescription}
        confirmLabel="מחיקה לצמיתות"
        pendingLabel="מוחק…"
        cancelLabel="ביטול"
        onConfirm={confirmDelete}
        pending={deletePending}
        error={deleteError}
      />
      <p role="status" className="basis-full text-sm font-medium">
        {status.message}
        {status.error ? <span className="text-destructive">{status.error}</span> : null}
      </p>
    </>
  );
}
