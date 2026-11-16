"use client";

import { ArchiveDeleteActions } from "@/components/archive-delete-actions";
import {
  archiveClientAction,
  deleteClientAction,
  restoreClientAction,
} from "@/lib/clients/actions";

type ClientStatusActionsProps = {
  clientId: string;
  clientName: string;
  isArchived: boolean;
};

/**
 * CLI-2: archive / restore, and permanent delete behind a confirmation dialog (owner
 * decision: allowed while the client has no projects or incomes; the database refuses
 * otherwise and the dialog says so).
 */
export function ClientStatusActions({
  clientId,
  clientName,
  isArchived,
}: ClientStatusActionsProps) {
  return (
    <ArchiveDeleteActions
      isArchived={isArchived}
      onArchive={() => archiveClientAction(clientId)}
      onRestore={() => restoreClientAction(clientId)}
      onDelete={() => deleteClientAction(clientId)}
      deleteTitle="למחוק את הלקוח לצמיתות?"
      deleteDescription={`הלקוח "${clientName}" וכל פרטיו יימחקו ולא יהיה אפשר לשחזר אותם. כדי רק להסתיר אותו מהרשימה, אפשר להעביר אותו לארכיון.`}
    />
  );
}
