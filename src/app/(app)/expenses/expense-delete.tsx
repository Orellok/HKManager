"use client";

import { useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { deleteExpenseAction } from "@/lib/expenses/actions";

/**
 * SPEC 6 / owner decision (M3): deletes an expense after confirmation. The record is kept in
 * the database as deleted (soft delete, recorded in the audit log), and so is its file; on
 * success the action redirects, and a failure is shown inside the dialog.
 */
export function ExpenseDelete({ expenseId }: { expenseId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedTransition();

  function confirmDelete() {
    start(async () => {
      setError(null);
      const call = await callServerAction(() => deleteExpenseAction(expenseId));
      if (call.status === "done") {
        setError(call.value.error);
      } else if (call.status === "failed") {
        setError(REQUEST_FAILED_MESSAGE);
      }
    });
  }

  return (
    <ConfirmDialog
      triggerLabel="מחיקת הוצאה"
      title="למחוק את ההוצאה?"
      description="ההוצאה תוסר מהרשימה ומהסכומים. הרישום נשמר ביומן השינויים, והקובץ המצורף לא נמחק."
      confirmLabel="מחיקת ההוצאה"
      pendingLabel="מוחק…"
      cancelLabel="חזרה"
      onConfirm={confirmDelete}
      pending={pending}
      error={error}
    />
  );
}
