import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import {
  ARCHIVED_CLIENTS_PATH,
  CLIENTS_PATH,
  NOTICE_PARAM,
  editClientPath,
} from "@/lib/clients/paths";

import { ClientStatusActions } from "./client-status-actions";
import { loadClientOrNotFound } from "./load-client";

const NOTICES: Record<string, string> = {
  created: "הלקוח נשמר.",
  updated: "השינויים נשמרו.",
};

type DetailRow = { label: string; value: string | null; href?: string; ltr?: boolean };

/** CLI-4: the client card. M1.1 shows the details; projects and balances come in M1.2 / M2. */
export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  await requireAllowedUser();
  const client = await loadClientOrNotFound(params);
  const noticeKey = (await searchParams)[NOTICE_PARAM];
  const notice = typeof noticeKey === "string" ? NOTICES[noticeKey] : undefined;
  const isArchived = client.archived_at !== null;

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

      <RedirectNotice message={notice} param={NOTICE_PARAM} />

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
    </article>
  );
}
