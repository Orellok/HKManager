import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import {
  ARCHIVED_CLIENTS_PATH,
  ARCHIVED_VIEW,
  CLIENTS_PATH,
  NEW_CLIENT_PATH,
  NOTICE_PARAM,
  VIEW_PARAM,
} from "@/lib/clients/paths";
import { logClientFailure } from "@/lib/clients/log";
import { clientNoticeMessage } from "@/lib/clients/notices";
import { listClients, type ClientListPage, type ClientListView } from "@/lib/clients/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { ClientsBrowser } from "./clients-browser";

const VIEWS: { view: ClientListView; label: string; href: string }[] = [
  { view: "active", label: "פעילים", href: CLIENTS_PATH },
  { view: "archived", label: "ארכיון", href: ARCHIVED_CLIENTS_PATH },
];

/** CLI-1 / CLI-2 / CLI-3: the client list, active or archived, with search. */
export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  await requireAllowedUser();
  const params = await searchParams;
  const view: ClientListView = params[VIEW_PARAM] === ARCHIVED_VIEW ? "archived" : "active";
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

      <RedirectNotice message={notice} param={NOTICE_PARAM} />

      <nav aria-label="תצוגת לקוחות">
        <ul className="flex gap-2">
          {VIEWS.map((item) => {
            const current = item.view === view;
            return (
              <li key={item.view}>
                <Link
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-md border px-4 text-sm",
                    current
                      ? "bg-primary text-primary-foreground border-primary font-bold"
                      : "hover:bg-accent",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <ClientsBrowser key={view} view={view} initialPage={initialPage} />
    </section>
  );
}
