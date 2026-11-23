import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { ViewTabs } from "@/components/view-tabs";
import { requireAllowedUser } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import type { ListPage } from "@/lib/paged-list";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  SHIFT_LABELS,
  calendarPath,
  calendarRange,
  parseCalendarParams,
  periodLabel,
  shiftedDate,
} from "@/lib/tasks/calendar";
import type { TaskReminderCounts } from "@/lib/tasks/grouping";
import { NEW_TASK_PATH } from "@/lib/tasks/paths";
import { getTaskReminderCounts, listCalendarTasks, type TaskListItem } from "@/lib/tasks/queries";

import { CalendarBody } from "./calendar-body";

const PERIOD_LINK_CLASSES = buttonClasses("secondary");

/**
 * CAL-1 / CAL-9 / CAL-11 (in-app part): the "יומן" screen. Agenda (the default), day, week
 * and month views; weeks start on Sunday and dates are in Asia/Jerusalem. It shows the open
 * tasks that have a due date on that date, each with its "בוצע" toggle (TASK-4), read from
 * the app's database only: it works with no Google connection (Google Calendar events come
 * with M5). The view and the date are in the address (`?view=week&date=2026-11-17`): codes
 * and dates only (SPEC 8).
 */
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  await requireAllowedUser();
  const today = todayInJerusalem();
  const params = parseCalendarParams(await searchParams, today);
  const range = calendarRange(params);
  let tasks: ListPage<TaskListItem>;
  let counts: TaskReminderCounts;
  try {
    const supabase = await createSupabaseServerClient();
    [tasks, counts] = await Promise.all([
      listCalendarTasks(supabase, range.from, range.to),
      getTaskReminderCounts(supabase, today),
    ]);
  } catch (error) {
    // Logged by code only; the error boundary gets no database details (SPEC 8).
    logDbFailure("calendar", "list tasks", error);
    throw new Error("Could not load the calendar's tasks");
  }
  const previous = shiftedDate(params, -1);
  const next = shiftedDate(params, 1);
  const shiftLabels = SHIFT_LABELS[params.view];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">יומן</h1>
        <Link href={NEW_TASK_PATH} className={buttonClasses("primary")}>
          משימה חדשה
        </Link>
      </div>
      <p className="text-muted-foreground max-w-prose text-sm">
        ביומן מוצגות המשימות הפתוחות בתאריך הדדליין שלהן. משימות בלי דדליין, ומשימות שבוצעו או
        בוטלו, אינן מוצגות כאן.
      </p>

      <ViewTabs
        label="תצוגת היומן"
        current={params.view}
        tabs={CALENDAR_VIEWS.map((view) => ({
          key: view,
          label: CALENDAR_VIEW_LABELS[view],
          href: calendarPath({ view, date: params.date }),
        }))}
      />

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{periodLabel(params)}</h2>
        <div role="group" aria-label="מעבר בין תקופות" className="flex flex-wrap gap-2">
          {previous ? (
            <Link
              href={calendarPath({ ...params, date: previous })}
              className={PERIOD_LINK_CLASSES}
            >
              {shiftLabels.previous}
            </Link>
          ) : null}
          <Link
            href={calendarPath({ ...params, date: today })}
            className={PERIOD_LINK_CLASSES}
            aria-current={params.date === today ? "date" : undefined}
          >
            היום
          </Link>
          {next ? (
            <Link href={calendarPath({ ...params, date: next })} className={PERIOD_LINK_CLASSES}>
              {shiftLabels.next}
            </Link>
          ) : null}
        </div>
      </div>

      <CalendarBody
        // Another view or date starts afresh; a refresh after a toggle keeps what is shown.
        key={`${params.view}|${params.date}`}
        params={params}
        range={range}
        today={today}
        tasks={tasks.items}
        hasMore={tasks.hasMore}
        overdueCount={counts.overdue}
      />
    </section>
  );
}
