import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClasses } from "@/components/button";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { clientPath } from "@/lib/clients/paths";
import { formatIsoDate, todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { newProjectIncomePath } from "@/lib/incomes/paths";
import {
  PROJECT_INCOMES_LIMIT,
  getProjectPaidTotal,
  listProjectIncomes,
  type ProjectIncome,
} from "@/lib/incomes/queries";
import { listProjectMilestones, type Milestone } from "@/lib/milestones/queries";
import { projectBalance } from "@/lib/milestones/totals";
import { formatAgorot } from "@/lib/money";
import type { ListPage } from "@/lib/paged-list";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import {
  ARCHIVED_PROJECTS_PATH,
  PROJECTS_PATH,
  PROJECT_NOTICE_MESSAGES,
  editProjectPath,
} from "@/lib/projects/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadProjectOrNotFound } from "./load-project";
import { ProjectMilestones, toPaymentItem } from "./project-milestones";
import { ProjectStatusActions } from "./project-status-actions";

type DetailRow = { label: string; value: ReactNode | null };

const LINK_CLASSES = "inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere";

const INCOMES_HEADING_ID = "project-incomes-heading";

/** PRJ-3: "יתרה" is contract − paid, shown only with a contract amount; an excess as such. */
function balanceValue(contractAmount: number | null, paid: number): string | null {
  const balance = projectBalance(contractAmount, paid);
  switch (balance.kind) {
    case "no_contract":
      return null;
    case "open":
      return formatAgorot(balance.balance);
    case "overpaid":
      return `שולם ביתר: ${formatAgorot(balance.excess)}`;
  }
}

/**
 * PRJ-3: the project card: details with contract amount, paid and balance, the milestones
 * with their payments (MS-1..5) and the project's incomes without a milestone.
 */
export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  await requireAllowedUser();
  const project = await loadProjectOrNotFound(params);
  const notice = noticeMessage(PROJECT_NOTICE_MESSAGES, (await searchParams)[NOTICE_PARAM]);
  const isArchived = project.archived_at !== null;
  let milestones: Milestone[];
  let incomes: ListPage<ProjectIncome>;
  let paid: number;
  try {
    const supabase = await createSupabaseServerClient();
    [milestones, incomes, paid] = await Promise.all([
      listProjectMilestones(supabase, project.id),
      listProjectIncomes(supabase, project.id),
      getProjectPaidTotal(supabase, project.id),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("projects", "read milestones and incomes", error);
    throw new Error("Could not load the project's milestones and incomes");
  }
  const withoutMilestone = incomes.items.filter((income) => income.milestone_id === null);

  const details: DetailRow[] = [
    {
      label: "לקוח",
      value: (
        <Link href={clientPath(project.client.id)} className={LINK_CLASSES}>
          {project.client.name}
          {project.client.archived_at !== null ? " (בארכיון)" : null}
        </Link>
      ),
    },
    { label: "כתובת הנכס", value: project.property_address },
    { label: "סטטוס", value: <ProjectStatusBadge status={project.status} /> },
    {
      label: "סכום חוזה",
      value: project.contract_amount === null ? null : formatAgorot(project.contract_amount),
    },
    { label: "שולם", value: formatAgorot(paid) },
    {
      label: "יתרה",
      value: balanceValue(project.contract_amount, paid) ?? (
        <span className="text-muted-foreground">אין סכום חוזה לחישוב יתרה</span>
      ),
    },
    {
      label: "תאריך התחלה",
      value: project.start_date === null ? null : formatIsoDate(project.start_date),
    },
    {
      label: "תאריך סיום",
      value: project.end_date === null ? null : formatIsoDate(project.end_date),
    },
    { label: "הערות", value: project.notes },
  ];

  return (
    <article className="space-y-6">
      <Link
        href={isArchived ? ARCHIVED_PROJECTS_PATH : PROJECTS_PATH}
        className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        חזרה לרשימת הפרויקטים
      </Link>

      <RedirectNotice message={notice} />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-semibold wrap-anywhere">{project.name}</h1>
        {isArchived ? (
          <span className="bg-muted rounded-full border px-3 py-1 text-sm">בארכיון</span>
        ) : null}
      </header>

      <dl className="divide-y rounded-lg border">
        {details.map(({ label, value }) => (
          <div key={label} className="grid gap-1 p-4 sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className="whitespace-pre-wrap wrap-anywhere">
              {value === null ? <span className="text-muted-foreground">לא הוזן</span> : value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-3">
        <Link href={editProjectPath(project.id)} className={buttonClasses("primary")}>
          עריכת פרטים
        </Link>
        <ProjectStatusActions
          projectId={project.id}
          projectName={project.name}
          isArchived={isArchived}
        />
      </div>

      <ProjectMilestones
        projectId={project.id}
        contractAmount={project.contract_amount}
        milestones={milestones}
        incomes={incomes.items.filter((income) => income.milestone_id !== null)}
        today={todayInJerusalem()}
      />

      <section aria-labelledby={INCOMES_HEADING_ID} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={INCOMES_HEADING_ID} className="text-xl font-semibold">
            הכנסות ללא אבן דרך
          </h2>
          <Link href={newProjectIncomePath(project.id)} className={buttonClasses("secondary")}>
            הכנסה חדשה לפרויקט
          </Link>
        </div>
        {withoutMilestone.length === 0 ? (
          <p className="text-muted-foreground">אין הכנסות לפרויקט שאינן משויכות לאבן דרך.</p>
        ) : (
          <ul aria-labelledby={INCOMES_HEADING_ID} className="divide-y rounded-lg border text-sm">
            {withoutMilestone.map(toPaymentItem).map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1"
              >
                <span className="flex flex-wrap gap-x-3">
                  <span>{payment.receivedDate}</span>
                  <span className="font-medium">{payment.amount}</span>
                  <span className="text-muted-foreground">{payment.paymentMethod}</span>
                </span>
                <Link
                  href={payment.editHref}
                  aria-label={`עריכת הכנסה מ-${payment.receivedDate} על סך ${payment.amount}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
                >
                  עריכה
                </Link>
              </li>
            ))}
          </ul>
        )}
        {incomes.hasMore ? (
          <p className="text-muted-foreground text-sm">
            מוצגות {PROJECT_INCOMES_LIMIT} ההכנסות הראשונות של הפרויקט. הסכום ששולם כולל את כולן,
            ואת כל ההכנסות אפשר למצוא ברשימת ההכנסות.
          </p>
        ) : null}
      </section>
    </article>
  );
}
