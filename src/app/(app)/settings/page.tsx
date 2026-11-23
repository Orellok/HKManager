import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { NEW_CATEGORY_PATH, SETTINGS_NOTICE_MESSAGES } from "@/lib/expense-categories/paths";
import {
  MAX_EXPENSE_CATEGORIES,
  listExpenseCategories,
  type ExpenseCategory,
} from "@/lib/expense-categories/queries";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CategoryList } from "./category-list";

const CATEGORIES_HEADING_ID = "expense-categories-heading";

/**
 * SPEC 5.14: the settings screen. M3 holds the expense categories (EXP-3; owner decision:
 * both allowlisted users manage them): add, rename, reorder, archive and restore.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await requireAllowedUser();
  const notice = noticeMessage(SETTINGS_NOTICE_MESSAGES, (await searchParams)[NOTICE_PARAM]);
  let categories: ExpenseCategory[];
  try {
    categories = await listExpenseCategories(await createSupabaseServerClient());
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("expense_categories", "list", error);
    throw new Error("Could not load the settings");
  }
  const canAdd = categories.length < MAX_EXPENSE_CATEGORIES;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">הגדרות</h1>
      <RedirectNotice message={notice} />
      <section aria-labelledby={CATEGORIES_HEADING_ID} className="max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={CATEGORIES_HEADING_ID} tabIndex={-1} className="text-xl font-semibold">
            קטגוריות הוצאה
          </h2>
          {canAdd ? (
            <Link href={NEW_CATEGORY_PATH} className={buttonClasses("primary")}>
              הוספת קטגוריה
            </Link>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          הקטגוריות מוצעות בטופס ההוצאה לפי הסדר כאן. קטגוריה בארכיון לא מוצעת בהוצאות חדשות, ונשארת
          בהוצאות שכבר נרשמו בה.
          {canAdd ? null : ` אפשר להגדיר עד ${MAX_EXPENSE_CATEGORIES} קטגוריות.`}
        </p>
        <CategoryList categories={categories} />
      </section>
    </div>
  );
}
