import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { RedirectNotice } from "@/components/redirect-notice";
import { ViewTabs } from "@/components/view-tabs";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { NOTICE_PARAM, noticeMessage } from "@/lib/notices";
import { TASK_NOTICE_MESSAGES } from "@/lib/tasks/notices";
import type { ListPage } from "@/lib/paged-list";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CALENDAR_PATH,
  CLOSED_TASKS_PATH,
  NEW_TASK_PATH,
  TASKS_PATH,
  TASKS_VIEW_PARAM,
  tasksViewFrom,
} from "@/lib/tasks/paths";
import {
  NO_TASK_FILTER,
  listClosedTasks,
  listOpenTasks,
  listTaskFilterOptions,
  type TaskFilterOptions,
  type TaskListItem,
} from "@/lib/tasks/queries";

import { TasksBrowser } from "./tasks-browser";

/**
 * TASK-6 / TASK-7: the tasks screen. The open tasks grouped by due date (TASK-3: overdue is
 * computed against today in Asia/Jerusalem), or the "בוצעו/בוטלו" tab (`?view=closed`), with
 * the priority, client and project filters.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  await requireAllowedUser();
  const params = await searchParams;
  const view = tasksViewFrom(params[TASKS_VIEW_PARAM]);
  const notice = noticeMessage(TASK_NOTICE_MESSAGES, params[NOTICE_PARAM]);
  const today = todayInJerusalem();
  let initialPage: ListPage<TaskListItem>;
  let filterOptions: TaskFilterOptions;
  try {
    const supabase = await createSupabaseServerClient();
    [initialPage, filterOptions] = await Promise.all([
      view === "open"
        ? listOpenTasks(supabase, NO_TASK_FILTER)
        : listClosedTasks(supabase, NO_TASK_FILTER, 0),
      listTaskFilterOptions(supabase),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("tasks", "list", error);
    throw new Error("Could not load the tasks list");
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">משימות</h1>
        <div className="flex flex-wrap gap-3">
          <Link href={CALENDAR_PATH} className={buttonClasses("secondary")}>
            ליומן
          </Link>
          <Link href={NEW_TASK_PATH} className={buttonClasses("primary")}>
            משימה חדשה
          </Link>
        </div>
      </div>

      <RedirectNotice message={notice} />

      <ViewTabs
        label="תצוגת משימות"
        current={view}
        tabs={[
          { key: "open", label: "פתוחות", href: TASKS_PATH },
          { key: "closed", label: "בוצעו/בוטלו", href: CLOSED_TASKS_PATH },
        ]}
      />

      <TasksBrowser
        // Another tab starts the list and its filters afresh.
        key={view}
        view={view}
        today={today}
        filterOptions={filterOptions}
        initialPage={initialPage}
      />
    </section>
  );
}
