import { notFound } from "next/navigation";

import { MissingDocumentBadge } from "@/components/missing-document-badge";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { updateExpenseAction } from "@/lib/expenses/actions";
import { EXPENSES_PATH, expenseFilePath } from "@/lib/expenses/paths";
import { getExpense } from "@/lib/expenses/queries";
import { expenseIdSchema, type ExpenseFormValues } from "@/lib/expenses/schema";
import { agorotToShekelInput } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ExpenseDelete } from "../../expense-delete";
import { ExpenseForm } from "../../expense-form";
import { loadCategoryOptions, loadOrNotFound } from "../../load-expense-form";

/**
 * EXP-1: edit an expense (attach a receipt later, or replace it; EXP-7 is shown with its
 * file), or soft-delete it (SPEC 6). An archived category stays on the expense it is on.
 */
export default async function EditExpensePage({ params }: PageProps<"/expenses/[id]/edit">) {
  await requireAllowedUser();
  const id = expenseIdSchema.safeParse((await params).id);
  if (!id.success) {
    notFound();
  }
  const expense = await loadOrNotFound("read", async () =>
    getExpense(await createSupabaseServerClient(), id.data),
  );
  const categoryOptions = await loadCategoryOptions(expense.category_id);
  const initialValues: ExpenseFormValues = {
    expense_date: expense.expense_date,
    amount: agorotToShekelInput(expense.amount),
    vendor: expense.vendor,
    category_id: expense.category_id,
    payment_method: expense.payment_method,
    notes: expense.notes ?? "",
    file: "",
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת הוצאה</h1>
      {expense.file_path === null ? (
        <p className="max-w-xl">
          <MissingDocumentBadge />
        </p>
      ) : null}
      <ExpenseForm
        action={updateExpenseAction.bind(null, expense.id)}
        initialValues={initialValues}
        categoryOptions={categoryOptions}
        today={todayInJerusalem()}
        currentFileHref={expense.file_path === null ? null : expenseFilePath(expense.id)}
        submitLabel="שמירת שינויים"
        cancelHref={EXPENSES_PATH}
      />
      <div className="max-w-xl border-t pt-6">
        <ExpenseDelete expenseId={expense.id} />
      </div>
    </section>
  );
}
