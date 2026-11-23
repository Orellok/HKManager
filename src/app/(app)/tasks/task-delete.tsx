"use client";

import { useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { deleteTaskAction } from "@/lib/tasks/actions";
import type { TaskReturnTarget } from "@/lib/tasks/paths";

/**
 * TASK-10: deletes a task after confirmation. The task is kept in the database as deleted
 * (soft delete); on success the action redirects, and a failure is shown inside the dialog.
 */
export function TaskDelete({ taskId, from }: { taskId: string; from: TaskReturnTarget }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedTransition();

  function confirmDelete() {
    start(async () => {
      setError(null);
      const call = await callServerAction(() => deleteTaskAction(taskId, from));
      if (call.status === "done") {
        setError(call.value.error);
      } else if (call.status === "failed") {
        setError(REQUEST_FAILED_MESSAGE);
      }
    });
  }

  return (
    <ConfirmDialog
      triggerLabel="מחיקת משימה"
      title="למחוק את המשימה?"
      description="המשימה תוסר מהרשימות, מהיומן ומהתזכורות."
      confirmLabel="מחיקת המשימה"
      pendingLabel="מוחק…"
      cancelLabel="חזרה"
      onConfirm={confirmDelete}
      pending={pending}
      error={error}
    />
  );
}
