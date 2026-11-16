"use client";

import { ArchiveDeleteActions } from "@/components/archive-delete-actions";
import {
  archiveProjectAction,
  deleteProjectAction,
  restoreProjectAction,
} from "@/lib/projects/actions";

type ProjectStatusActionsProps = {
  projectId: string;
  projectName: string;
  isArchived: boolean;
};

/**
 * Owner decision (M1.2): archive / restore, and permanent delete behind a confirmation dialog
 * while the project has no milestones or incomes (the database refuses otherwise).
 */
export function ProjectStatusActions({
  projectId,
  projectName,
  isArchived,
}: ProjectStatusActionsProps) {
  return (
    <ArchiveDeleteActions
      isArchived={isArchived}
      onArchive={() => archiveProjectAction(projectId)}
      onRestore={() => restoreProjectAction(projectId)}
      onDelete={() => deleteProjectAction(projectId)}
      deleteTitle="למחוק את הפרויקט לצמיתות?"
      deleteDescription={`הפרויקט "${projectName}" וכל פרטיו יימחקו ולא יהיה אפשר לשחזר אותם. כדי רק להסתיר אותו מהרשימה, אפשר להעביר אותו לארכיון.`}
    />
  );
}
