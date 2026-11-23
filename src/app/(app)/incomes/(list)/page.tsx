import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { ViewTabs } from "@/components/view-tabs";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import {
  getReceiptsSummary,
  listPendingReceipts,
  type ReceiptsSummary,
} from "@/lib/documents/queries";
import { EXPORT_PATH } from "@/lib/export/range";
import { monthOf } from "@/lib/incomes/month";
import {
  INCOMES_PATH,
  INCOME_NOTICE_MESSAGES,
  NEW_INCOME_PATH,
  PENDING_RECEIPTS_PATH,
  PENDING_VIEW,
} from "@/lib/incomes/paths";
import {
  getIncomesMonthSummary,
  listArchivedClientsWithIncomes,
  listIncomes,
  type FilterClients,
  type IncomeListPage,
  type IncomesMonthSummary,
} from "@/lib/incomes/queries";
import { VIEW_PARAM } from "@/lib/list-view";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { listActiveClientOptions, type ClientOptions } from "@/lib/projects/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { IncomesBrowser } from "./incomes-browser";
import { PendingReceiptsBrowser } from "./pending-receipts-browser";

const VIEWS = [
  { key: "month", label: "לפי חודש", href: INCOMES_PATH },
  { key: "pending", label: "ממתינות לקבלה", href: PENDING_RECEIPTS_PATH },
] as const;

function pendingCountText(count: number): string {
  return count === 1 ? "הכנסה אחת ממתינה לקבלה." : `${count} הכנסות ממתינות לקבלה.`;
}

/**
 * INC-1 / owner decision (M2.1): the incomes screen: a month's incomes, newest received date
 * first, filtered by month and client, with the month's total and "load more". It opens on
 * the current month (Asia/Jerusalem) and all clients. The client filter offers the active
 * clients and the archived ones that have incomes. INC-3: each income shows its receipt
 * status. DOC-5 / owner decision (M2.2): the "ממתינות לקבלה" view lists the incomes waiting
 * for a receipt, of every month.
 */
export default async function IncomesPage({ searchParams }: PageProps<"/incomes">) {
  await requireAllowedUser();
  const params = await searchParams;
  const notice = noticeMessage(INCOME_NOTICE_MESSAGES, params[NOTICE_PARAM]);
  const isPendingView = params[VIEW_PARAM] === PENDING_VIEW;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">הכנסות</h1>
        <div className="flex flex-wrap gap-3">
          <Link href={EXPORT_PATH} className={buttonClasses("secondary")}>
            ייצוא ל-CSV
          </Link>
          <Link href={NEW_INCOME_PATH} className={buttonClasses("primary")}>
            הכנסה חדשה
          </Link>
        </div>
      </div>

      <RedirectNotice message={notice} />

      <ViewTabs label="תצוגת ההכנסות" tabs={VIEWS} current={isPendingView ? "pending" : "month"} />

      {isPendingView ? <PendingView /> : <MonthView />}
    </section>
  );
}

async function MonthView() {
  const month = monthOf(todayInJerusalem());
  const filter = { month, clientId: null };
  let initialPage: IncomeListPage;
  let summary: IncomesMonthSummary;
  let clients: ClientOptions;
  let archivedClients: FilterClients;
  try {
    const supabase = await createSupabaseServerClient();
    [initialPage, summary, clients, archivedClients] = await Promise.all([
      listIncomes(supabase, filter, 0),
      getIncomesMonthSummary(supabase, filter),
      listActiveClientOptions(supabase),
      listArchivedClientsWithIncomes(supabase),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("incomes", "list", error);
    throw new Error("Could not load the incomes list");
  }
  return (
    <IncomesBrowser
      initialMonth={month}
      clientOptions={[...clients.options, ...archivedClients.options]}
      moreClientsExist={clients.hasMore || archivedClients.hasMore}
      initialPage={initialPage}
      initialSummary={summary}
    />
  );
}

async function PendingView() {
  let initialPage: IncomeListPage;
  let summary: ReceiptsSummary;
  try {
    const supabase = await createSupabaseServerClient();
    [initialPage, summary] = await Promise.all([
      listPendingReceipts(supabase, 0),
      getReceiptsSummary(supabase),
    ]);
  } catch (error) {
    logDbFailure("documents", "list pending", error);
    throw new Error("Could not load the pending receipts list");
  }
  return (
    <div className="space-y-4">
      {summary.pendingCount > 0 ? (
        <p className="text-sm">
          {pendingCountText(summary.pendingCount)}{" "}
          <span className="text-muted-foreground">
            הוותיקות קודם. לחיצה על הכנסה פותחת את הפקת הקבלה שלה.
          </span>
        </p>
      ) : null}
      <PendingReceiptsBrowser initialPage={initialPage} />
    </div>
  );
}
