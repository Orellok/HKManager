import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { SETTINGS_PATH } from "@/lib/expense-categories/paths";
import { createExpenseAction } from "@/lib/expenses/actions";
import { EXPENSES_PATH } from "@/lib/expenses/paths";
import { EMPTY_EXPENSE_FORM_VALUES } from "@/lib/expenses/schema";

import { ExpenseForm } from "../expense-form";
import { loadCategoryOptions } from "../load-expense-form";

/**
 * EXP-1 / EXP-2: a new expense, with a receipt photo or file or without one (EXP-6). The
 * category list offers the active categories only (owner decision M3).
 */
export default async function NewExpensePage() {
  await requireAllowedUser();
  const today = todayInJerusalem();
  const categoryOptions = await loadCategoryOptions();

  if (categoryOptions.length === 0) {
    return (
      <section className="space-y-6">
        <h1 className="text-2xl font-semibold">הוצאה חדשה</h1>
        <div className="max-w-xl space-y-3 rounded-lg border p-6">
          <p className="font-medium">אין קטגוריות הוצאה פעילות.</p>
          <p className="text-muted-foreground text-sm">
            כל הוצאה שייכת לקטגוריה. אפשר להוסיף קטגוריה או להחזיר אחת מהארכיון בהגדרות.
          </p>
          <Link href={SETTINGS_PATH} className={buttonClasses("primary")}>
            להגדרות
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">הוצאה חדשה</h1>
      <ExpenseForm
        action={createExpenseAction}
        initialValues={{ ...EMPTY_EXPENSE_FORM_VALUES, expense_date: today }}
        categoryOptions={categoryOptions}
        today={today}
        currentFileHref={null}
        submitLabel="שמירת הוצאה"
        cancelHref={EXPENSES_PATH}
      />
    </section>
  );
}
