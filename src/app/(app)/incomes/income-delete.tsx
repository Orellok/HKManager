"use client";

import { useState } from "react";

import { REQUEST_FAILED_MESSAGE } from "@/components/archive-delete-actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { callServerAction } from "@/lib/auth/action-failure";
import { deleteIncomeAction } from "@/lib/incomes/actions";
import type { ReturnTarget } from "@/lib/incomes/paths";

type IncomeDeleteProps = { incomeId: string; from: ReturnTarget };

/**
 * SPEC 6: deletes an income after confirmation. The record is kept in the database as
 * deleted (soft delete, recorded in the audit log); on success the action redirects, and a
 * failure is shown inside the dialog.
 */
export function IncomeDelete({ incomeId, from }: IncomeDeleteProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useGuardedTransition();

  function confirmDelete() {
    start(async () => {
      setError(null);
      const call = await callServerAction(() => deleteIncomeAction(incomeId, from));
      if (call.status === "done") {
        setError(call.value.error);
      } else if (call.status === "failed") {
        setError(REQUEST_FAILED_MESSAGE);
      }
    });
  }

  return (
    <ConfirmDialog
      triggerLabel="מחיקת הכנסה"
      title="למחוק את ההכנסה?"
      description="ההכנסה תוסר מהרשימות ומהסכומים, והיתרה של אבן הדרך תתעדכן. הרישום נשמר ביומן השינויים."
      confirmLabel="מחיקת ההכנסה"
      pendingLabel="מוחק…"
      cancelLabel="חזרה"
      onConfirm={confirmDelete}
      pending={pending}
      error={error}
    />
  );
}
