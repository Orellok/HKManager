import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { listExpenseCategories, type ExpenseCategory } from "@/lib/expense-categories/queries";
import {
  EXPENSE_NOTICE_MESSAGES,
  NEW_EXPENSE_PATH,
  isPersistentExpenseNotice,
} from "@/lib/expenses/paths";
import {
  getExpensesSummary,
  listExpenses,
  type ExpenseListPage,
  type ExpensesSummary,
} from "@/lib/expenses/queries";
import { monthOf } from "@/lib/incomes/month";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { categoryLabel } from "../load-expense-form";
import { ExpensesBrowser } from "./expenses-browser";

/**
 * EXP-4 / EXP-6: the expenses screen: a month's expenses, newest first, filtered by month,
 * category, vendor and "חסר מסמך", with the filter's total and "load more". It opens on the
 * current month (Asia/Jerusalem) with no other filter. EXP-7: the confirmation after saving
 * with a file stays on screen.
 */
export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  await requireAllowedUser();
  const noticeCode = (await searchParams)[NOTICE_PARAM];
  const notice = noticeMessage(EXPENSE_NOTICE_MESSAGES, noticeCode);
  const month = monthOf(todayInJerusalem());
  const filter = { month, categoryId: null, vendor: "", missingDocument: false };
  let initialPage: ExpenseListPage;
  let summary: ExpensesSummary;
  let categories: ExpenseCategory[];
  try {
    const supabase = await createSupabaseServerClient();
    [initialPage, summary, categories] = await Promise.all([
      listExpenses(supabase, filter, 0),
      getExpensesSummary(supabase, filter),
      listExpenseCategories(supabase),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("expenses", "list", error);
    throw new Error("Could not load the expenses list");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">הוצאות</h1>
        <Link href={NEW_EXPENSE_PATH} className={buttonClasses("primary")}>
          הוצאה חדשה
        </Link>
      </div>

      <RedirectNotice message={notice} persistent={isPersistentExpenseNotice(noticeCode)} />

      <ExpensesBrowser
        initialMonth={month}
        categoryOptions={categories.map((category) => ({
          id: category.id,
          name: category.name,
          label: categoryLabel(category),
        }))}
        initialPage={initialPage}
        initialSummary={summary}
      />
    </section>
  );
}
