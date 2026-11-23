import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { CardTasks } from "@/components/card-tasks";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { logClientFailure } from "@/lib/clients/log";
import { clientNoticeMessage } from "@/lib/clients/notices";
import { ARCHIVED_CLIENTS_PATH, CLIENTS_PATH, editClientPath } from "@/lib/clients/paths";
import { todayInJerusalem } from "@/lib/dates";
import { getClientPaymentSummary, type ClientPaymentSummary } from "@/lib/incomes/queries";
import { formatAgorot } from "@/lib/money";
import { NOTICE_PARAM } from "@/lib/notices";
import { listClientProjects, type ClientProject } from "@/lib/projects/queries";
import type { ListPage } from "@/lib/paged-list";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { newClientTaskPath } from "@/lib/tasks/paths";
import { listCardTasks, type TaskListItem } from "@/lib/tasks/queries";

import { ClientProjects } from "./client-projects";
import { ClientStatusActions } from "./client-status-actions";
import { loadClientOrNotFound } from "./load-client";

type DetailRow = { label: string; value: string | null; href?: string; ltr?: boolean };

/**
 * CLI-4: the client card: details, total paid, open balance and projects; TASK-8: its open
 * tasks with quick create.
 */
export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  await requireAllowedUser();
  const client = await loadClientOrNotFound(params);
  const notice = clientNoticeMessage((await searchParams)[NOTICE_PARAM]);
  const isArchived = client.archived_at !== null;
  let projects: ListPage<ClientProject>;
  let payments: ClientPaymentSummary;
  let tasks: ListPage<TaskListItem>;
  try {
    const supabase = await createSupabaseServerClient();
    [projects, payments, tasks] = await Promise.all([
      listClientProjects(supabase, client.id),
      getClientPaymentSummary(supabase, client.id),
      listCardTasks(supabase, { clientId: client.id }),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logClientFailure("read projects, payments and tasks", error);
    throw new Error("Could not load the client's projects, payments and tasks");
  }

  const details: DetailRow[] = [
    {
      label: "טלפון",
      value: client.phone,
      href: client.phone ? `tel:${client.phone.replace(/[^0-9+]/g, "")}` : undefined,
      ltr: true,
    },
    {
      label: "מייל",
      value: client.email,
      href: client.email ? `mailto:${client.email}` : undefined,
      ltr: true,
    },
    { label: "כתובת", value: client.address },
    { label: "הערות", value: client.notes },
  ];

  return (
    <article className="space-y-6">
      <Link
        href={isArchived ? ARCHIVED_CLIENTS_PATH : CLIENTS_PATH}
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        חזרה לרשימת הלקוחות
      </Link>

      <RedirectNotice message={notice} />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold wrap-anywhere">{client.name}</h1>
        {isArchived ? (
          <span className="bg-muted rounded-full border px-3 py-1 text-sm">בארכיון</span>
        ) : null}
      </header>

      <dl className="divide-y rounded-lg border">
        {details.map(({ label, value, href, ltr }) => (
          <div key={label} className="grid gap-1 p-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="whitespace-pre-wrap wrap-anywhere">
              {value === null ? (
                <span className="text-muted-foreground">לא הוזן</span>
              ) : href ? (
                <a
                  href={href}
                  dir={ltr ? "ltr" : undefined}
                  className="inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere"
                >
                  {value}
                </a>
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-3">
        <Link href={editClientPath(client.id)} className={buttonClasses("primary")}>
          עריכת פרטים
        </Link>
        <ClientStatusActions
          clientId={client.id}
          clientName={client.name}
          isArchived={isArchived}
        />
      </div>

      <section aria-labelledby="client-payments-heading" className="space-y-3">
        <h2 id="client-payments-heading" className="text-xl font-semibold">
          תשלומים
        </h2>
        <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-sm">סה״כ שולם</dt>
            <dd className="text-xl font-semibold">{formatAgorot(payments.totalPaid)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">
              יתרה פתוחה באבני דרך (פרויקטים שאינם בארכיון)
            </dt>
            <dd className="text-xl font-semibold">{formatAgorot(payments.openBalance)}</dd>
          </div>
        </dl>
      </section>

      <ClientProjects clientId={client.id} isClientArchived={isArchived} projects={projects} />

      <CardTasks
        tasks={tasks}
        today={todayInJerusalem()}
        newTaskHref={newClientTaskPath(client.id)}
        from="client"
      />
    </article>
  );
}
