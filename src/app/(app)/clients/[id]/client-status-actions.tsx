"use client";

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

  function toggleArchive() {
    startArchive(async () => {
      setStatus(await (isArchived ? restoreClientAction : archiveClientAction)(clientId));
    });
  }

  function confirmDelete() {
    setDeleteError(null);
    startDelete(async () => {
      // On success the action redirects to the list; it only returns on failure.
      const result = await deleteClientAction(clientId);
      setDeleteError(result.error);
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={toggleArchive}
        disabled={archivePending}
        aria-busy={archivePending}
      >
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
