import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClasses } from "@/components/button";
import { ProjectStatusBadge } from "@/components/project-status-badge";
import { RedirectNotice } from "@/components/redirect-notice";
import { requireAllowedUser } from "@/lib/auth/guards";
import { clientPath } from "@/lib/clients/paths";
import { formatIsoDate, todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { listProjectMilestones, type Milestone } from "@/lib/milestones/queries";
import { formatAgorot } from "@/lib/money";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import {
  ARCHIVED_PROJECTS_PATH,
  PROJECTS_PATH,
  PROJECT_NOTICE_MESSAGES,
  editProjectPath,
} from "@/lib/projects/paths";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { loadProjectOrNotFound } from "./load-project";
import { ProjectMilestones } from "./project-milestones";
import { ProjectStatusActions } from "./project-status-actions";

type DetailRow = { label: string; value: ReactNode | null };

const LINK_CLASSES = "inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere";

/**
 * PRJ-3: the project card: details and milestones (MS-1..3). "שולם" and "יתרה" come with
 * incomes (M2).
 */
export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  await requireAllowedUser();
  const project = await loadProjectOrNotFound(params);
  const notice = noticeMessage(PROJECT_NOTICE_MESSAGES, (await searchParams)[NOTICE_PARAM]);
  const isArchived = project.archived_at !== null;
  let milestones: Milestone[];
  try {
    milestones = await listProjectMilestones(await createSupabaseServerClient(), project.id);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("milestones", "list", error);
    throw new Error("Could not load the project's milestones");
  }

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
        today={todayInJerusalem()}
      />
    </article>
  );
}
