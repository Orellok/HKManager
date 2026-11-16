import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { ViewTabs } from "@/components/view-tabs";
import { requireAllowedUser } from "@/lib/auth/guards";
import { VIEW_PARAM, listViewFrom } from "@/lib/list-view";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import {
  ARCHIVED_PROJECTS_PATH,
  NEW_PROJECT_PATH,
  PROJECTS_PATH,
  PROJECT_NOTICE_MESSAGES,
} from "@/lib/projects/paths";
import { listProjects, type ProjectListPage } from "@/lib/projects/queries";
import { DEFAULT_STATUS_FILTER, type ProjectStatusFilter } from "@/lib/projects/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ProjectsBrowser } from "./projects-browser";

const VIEWS = [
  { key: "active", label: "פרויקטים", href: PROJECTS_PATH },
  { key: "archived", label: "ארכיון", href: ARCHIVED_PROJECTS_PATH },
] as const;

/**
 * PRJ-1: the project list with search and status filter. Owner decision (M1.2): it opens on
 * the open statuses (lead, active, on_hold); the archive shows every status.
 */
export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  await requireAllowedUser();
  const params = await searchParams;
  const view = listViewFrom(params[VIEW_PARAM]);
  const status: ProjectStatusFilter = view === "archived" ? "all" : DEFAULT_STATUS_FILTER;
  const notice = noticeMessage(PROJECT_NOTICE_MESSAGES, params[NOTICE_PARAM]);

  let initialPage: ProjectListPage;
  try {
    initialPage = await listProjects(await createSupabaseServerClient(), {
      view,
      status,
      query: "",
      offset: 0,
    });
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("projects", "list", error);
    throw new Error("Could not load the project list");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">פרויקטים</h1>
        <Link href={NEW_PROJECT_PATH} className={buttonClasses("primary")}>
          פרויקט חדש
        </Link>
      </div>

      <RedirectNotice message={notice} />

      <ViewTabs label="תצוגת פרויקטים" tabs={VIEWS} current={view} />

      <ProjectsBrowser key={view} view={view} initialStatus={status} initialPage={initialPage} />
    </section>
  );
}
