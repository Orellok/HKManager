import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { ViewTabs } from "@/components/view-tabs";
import { requireAllowedUser } from "@/lib/auth/guards";
import { ARCHIVED_CLIENTS_PATH, CLIENTS_PATH, NEW_CLIENT_PATH } from "@/lib/clients/paths";
import { logClientFailure } from "@/lib/clients/log";
import { clientNoticeMessage } from "@/lib/clients/notices";
import { listClients, type ClientListPage, type ClientListView } from "@/lib/clients/queries";
import { VIEW_PARAM, listViewFrom } from "@/lib/list-view";
import { NOTICE_PARAM } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ClientsBrowser } from "./clients-browser";

const VIEWS = [
  { key: "active", label: "פעילים", href: CLIENTS_PATH },
  { key: "archived", label: "ארכיון", href: ARCHIVED_CLIENTS_PATH },
] as const;

/** CLI-1 / CLI-2 / CLI-3: the client list, active or archived, with search. */
export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  await requireAllowedUser();
  const params = await searchParams;
  const view: ClientListView = listViewFrom(params[VIEW_PARAM]);
  const notice = clientNoticeMessage(params[NOTICE_PARAM]);

  let initialPage: ClientListPage;
  try {
    initialPage = await listClients(await createSupabaseServerClient(), {
      view,
      query: "",
      offset: 0,
    });
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logClientFailure("list", error);
    throw new Error("Could not load the client list");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">לקוחות</h1>
        <Link href={NEW_CLIENT_PATH} className={buttonClasses("primary")}>
          לקוח חדש
        </Link>
      </div>

      <RedirectNotice message={notice} />

      <ViewTabs label="תצוגת לקוחות" tabs={VIEWS} current={view} />

      <ClientsBrowser key={view} view={view} initialPage={initialPage} />
    </section>
  );
}
