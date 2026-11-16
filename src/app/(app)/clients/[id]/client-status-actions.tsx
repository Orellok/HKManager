"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  archiveClientAction,
  deleteClientAction,
  restoreClientAction,
  type ClientStatusState,
} from "@/lib/clients/actions";

type ClientStatusActionsProps = {
  clientId: string;
  clientName: string;
  isArchived: boolean;
};

const NO_STATUS: ClientStatusState = { message: null, error: null };
const REQUEST_FAILED_MESSAGE = "הפעולה לא בוצעה. בדקו את החיבור ונסו שוב.";

function archiveButtonLabel(isArchived: boolean, pending: boolean): string {
  if (isArchived) {
    return pending ? "מחזיר מהארכיון…" : "שחזור מהארכיון";
  }
  return pending ? "מעביר לארכיון…" : "העברה לארכיון";
}

/**
 * CLI-2: archive / restore, and permanent delete behind a confirmation dialog (owner
 * decision: allowed while the client has no projects or incomes). Results are announced in a
 * live region.
 */
export function ClientStatusActions({
  clientId,
  clientName,
  isArchived,
}: ClientStatusActionsProps) {
  const [status, setStatus] = useState<ClientStatusState>(NO_STATUS);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [archivePending, startArchive] = useTransition();
  const [deletePending, startDelete] = useTransition();

  // The archive button stays mounted and focused (it is never `disabled`), so after the
  // action keyboard focus is on its counterpart: "שחזור מהארכיון" after archiving.
  function toggleArchive() {
    if (archivePending) {
      return;
    }
    setStatus(NO_STATUS);
    startArchive(async () => {
      try {
        setStatus(await (isArchived ? restoreClientAction : archiveClientAction)(clientId));
      } catch {
        // The request failed (no connection, server error); nothing changed.
        setStatus({ message: null, error: REQUEST_FAILED_MESSAGE });
      }
    });
  }

  function confirmDelete() {
    if (deletePending) {
      return;
    }
    setDeleteError(null);
    startDelete(async () => {
      try {
        // On success the action redirects to the list; it only returns on failure.
        const result = await deleteClientAction(clientId);
        setDeleteError(result.error);
      } catch (error) {
        unstable_rethrow(error);
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
        title="למחוק את הלקוח לצמיתות?"
        description={`הלקוח "${clientName}" וכל פרטיו יימחקו ולא יהיה אפשר לשחזר אותם. כדי רק להסתיר אותו מהרשימה, אפשר להעביר אותו לארכיון.`}
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
