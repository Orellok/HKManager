import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { monthOf } from "@/lib/incomes/month";
import { INCOME_NOTICE_MESSAGES, NEW_INCOME_PATH } from "@/lib/incomes/paths";
import {
  getIncomesMonthSummary,
  listArchivedClientsWithIncomes,
  listIncomes,
  type FilterClients,
  type IncomeListPage,
  type IncomesMonthSummary,
} from "@/lib/incomes/queries";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { listActiveClientOptions, type ClientOptions } from "@/lib/projects/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { IncomesBrowser } from "./incomes-browser";

/**
 * INC-1 / owner decision (M2.1): the incomes screen: a month's incomes, newest received date
 * first, filtered by month and client, with the month's total and "load more". It opens on
 * the current month (Asia/Jerusalem) and all clients. The client filter offers the active
 * clients and the archived ones that have incomes.
 */
export default async function IncomesPage({ searchParams }: PageProps<"/incomes">) {
  await requireAllowedUser();
  const notice = noticeMessage(INCOME_NOTICE_MESSAGES, (await searchParams)[NOTICE_PARAM]);
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
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">הכנסות</h1>
        <Link href={NEW_INCOME_PATH} className={buttonClasses("primary")}>
          הכנסה חדשה
        </Link>
      </div>

      <RedirectNotice message={notice} />

      <IncomesBrowser
        initialMonth={month}
        clientOptions={[...clients.options, ...archivedClients.options]}
        moreClientsExist={clients.hasMore || archivedClients.hasMore}
        initialPage={initialPage}
        initialSummary={summary}
      />
    </section>
  );
}
