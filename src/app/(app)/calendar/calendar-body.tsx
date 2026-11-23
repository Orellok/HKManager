"use client";

import Link from "next/link";
import { useState } from "react";

import { ToggleAnnouncement, useTaskDoneToggles } from "@/components/task-done";
import { TaskRow } from "@/components/task-row";
import { MAX_ISO_DATE, MIN_ISO_DATE } from "@/lib/dates";
import {
  WEEKDAY_NAMES,
  WEEKDAY_SHORT_NAMES,
  calendarPath,
  datesBetween,
  dayLabel,
  monthLabel,
  type CalendarParams,
  type CalendarRange,
} from "@/lib/tasks/calendar";
import { TASKS_PATH } from "@/lib/tasks/paths";
import { CALENDAR_TASKS_LIMIT, type TaskListItem } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

type CalendarBodyProps = {
  params: CalendarParams;
  range: CalendarRange;
  today: string;
  tasks: readonly TaskListItem[];
  /** More tasks are due in the range than CALENDAR_TASKS_LIMIT. */
  hasMore: boolean;
  overdueCount: number;
};

type Toggles = ReturnType<typeof useTaskDoneToggles>;

/** Titles shown in a month cell from the md breakpoint; the rest are counted. */
const MONTH_CELL_TITLES = 3;

function tasksCountText(count: number): string {
  if (count === 0) {
    return "אין משימות";
  }
  return count === 1 ? "משימה אחת" : `${count} משימות`;
}

function groupByDate(tasks: readonly TaskListItem[]): Map<string, TaskListItem[]> {
  const byDate = new Map<string, TaskListItem[]>();
  for (const task of tasks) {
    if (task.due_date === null) {
      continue;
    }
    const list = byDate.get(task.due_date) ?? [];
    list.push(task);
    byDate.set(task.due_date, list);
  }
  return byDate;
}

/**
 * CAL-1 / CAL-11: the body of a calendar view. The tasks are kept as they were loaded, so a
 * task marked done here stays on screen (pressed) until the next visit and can be undone in
 * place; the page is keyed by view and date, so moving to another period starts afresh.
 * Tasks are marked "משימה" and drawn with a dashed border, apart from calendar events (M5).
 */
export function CalendarBody({
  params,
  range,
  today,
  tasks,
  hasMore,
  overdueCount,
}: CalendarBodyProps) {
  const [shown] = useState(tasks);
  const toggles = useTaskDoneToggles();
  const byDate = groupByDate(shown);

  return (
    <div className="space-y-4">
      <ToggleAnnouncement announcement={toggles.announcement} />
      {params.view === "agenda" && params.date === today && overdueCount > 0 ? (
        <p className="text-sm">
          {overdueCount === 1 ? "משימה אחת באיחור" : `${overdueCount} משימות באיחור`} אינן בטווח
          הזה.{" "}
          <Link href={TASKS_PATH} className="inline-flex min-h-11 items-center underline">
            לרשימת המשימות
          </Link>
        </p>
      ) : null}
      {params.view === "agenda" ? (
        <AgendaView range={range} today={today} byDate={byDate} toggles={toggles} />
      ) : null}
      {params.view === "day" ? (
        <DaySection
          date={params.date}
          today={today}
          tasks={byDate.get(params.date) ?? []}
          toggles={toggles}
          headingLevel="h3"
          emptyText="אין משימות פתוחות עם דדליין ביום הזה."
        />
      ) : null}
      {params.view === "week" ? (
        <WeekView range={range} today={today} byDate={byDate} toggles={toggles} />
      ) : null}
      {params.view === "month" ? (
        <MonthView params={params} range={range} today={today} byDate={byDate} toggles={toggles} />
      ) : null}
      {hasMore ? (
        <p className="text-muted-foreground text-sm">
          מוצגות {CALENDAR_TASKS_LIMIT} המשימות הראשונות בטווח. את כולן אפשר למצוא ברשימת המשימות.
        </p>
      ) : null}
    </div>
  );
}

function TaskMark() {
  return (
    <span className="bg-background inline-flex shrink-0 items-center rounded-full border border-dashed border-current px-2 text-xs">
      משימה
    </span>
  );
}

type DaySectionProps = {
  date: string;
  today: string;
  tasks: readonly TaskListItem[];
  toggles: Toggles;
  headingLevel: "h3" | "h4";
  emptyText?: string;
  stacked?: boolean;
  className?: string;
};

/** One day: its heading (today marked in words) and its tasks with their toggles. */
function DaySection({
  date,
  today,
  tasks,
  toggles,
  headingLevel: Heading,
  emptyText,
  stacked,
  className,
}: DaySectionProps) {
  const headingId = `calendar-day-${date}`;
  const isToday = date === today;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("min-w-0 space-y-2", className)}
      aria-current={isToday ? "date" : undefined}
    >
      <Heading id={headingId} className="flex flex-wrap items-center gap-2 font-semibold">
        {dayLabel(date)}
        {isToday ? (
          <span className="bg-primary text-primary-foreground rounded-full px-2 text-xs">היום</span>
        ) : null}
      </Heading>
      {tasks.length === 0 ? (
        emptyText ? (
          <p className="text-muted-foreground text-sm">{emptyText}</p>
        ) : null
      ) : (
        <ul aria-labelledby={headingId} className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-lg border-2 border-dashed">
              <div className="px-4 pt-2 md:px-2">
                <TaskMark />
              </div>
              <TaskRow
                task={task}
                status={toggles.statusOf(task)}
                today={today}
                pending={toggles.isPending(task.id)}
                onToggle={() => toggles.toggle(task)}
                showDueDate={false}
                stacked={stacked}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type RangeViewProps = {
  range: CalendarRange;
  today: string;
  byDate: Map<string, TaskListItem[]>;
  toggles: Toggles;
};

/** CAL-1: the agenda: the days of the range that have tasks, in order (default on mobile). */
function AgendaView({ range, today, byDate, toggles }: RangeViewProps) {
  const days = datesBetween(range.from, range.to).filter((date) => byDate.has(date));
  if (days.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="font-medium">אין משימות פתוחות עם דדליין בטווח הזה.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {days.map((date) => (
        <DaySection
          key={date}
          date={date}
          today={today}
          tasks={byDate.get(date) ?? []}
          toggles={toggles}
          headingLevel="h3"
        />
      ))}
    </div>
  );
}

/** CAL-1: the week, Sunday to Saturday: a list on mobile, seven columns on desktop. */
function WeekView({ range, today, byDate, toggles }: RangeViewProps) {
  return (
    <div className="grid gap-4 md:grid-cols-7 md:gap-2">
      {datesBetween(range.from, range.to).map((date) => (
        <DaySection
          key={date}
          date={date}
          today={today}
          tasks={byDate.get(date) ?? []}
          toggles={toggles}
          headingLevel="h3"
          emptyText="אין משימות."
          stacked
          className={cn(
            "md:rounded-lg md:border md:p-2",
            date === today && "md:border-2 md:border-current",
          )}
        />
      ))}
    </div>
  );
}

/**
 * CAL-1: the month as a table of weeks (Sunday first). Each day is a link that selects it;
 * the selected day's tasks, with their toggles, are listed under the table. A link's name
 * starts with the visible day number and then says the full date, the number of tasks, and
 * whether it is today or selected.
 */
function MonthView({
  params,
  range,
  today,
  byDate,
  toggles,
}: RangeViewProps & { params: CalendarParams }) {
  const dates = datesBetween(range.from, range.to);
  const weeks: string[][] = [];
  for (let start = 0; start < dates.length; start += 7) {
    weeks.push(dates.slice(start, start + 7));
  }
  const month = params.date.slice(0, 7);
  return (
    <div className="space-y-6">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">
          {monthLabel(params.date)}: מספר המשימות הפתוחות בכל יום. בחירת יום מציגה את המשימות שלו
          מתחת לטבלה.
        </caption>
        <thead>
          <tr>
            {WEEKDAY_NAMES.map((name, index) => (
              <th key={name} scope="col" className="p-1 text-center text-sm font-medium">
                <span aria-hidden="true">{WEEKDAY_SHORT_NAMES[index]}</span>
                <span className="sr-only">{name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((date) => (
                <MonthCell
                  key={date}
                  date={date}
                  inMonth={date.slice(0, 7) === month}
                  isToday={date === today}
                  isSelected={date === params.date}
                  tasks={byDate.get(date) ?? []}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <DaySection
        date={params.date}
        today={today}
        tasks={byDate.get(params.date) ?? []}
        toggles={toggles}
        headingLevel="h3"
        emptyText="אין משימות פתוחות עם דדליין ביום הזה."
        className="rounded-lg border p-4"
      />
    </div>
  );
}

function MonthCell({
  date,
  inMonth,
  isToday,
  isSelected,
  tasks,
}: {
  date: string;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  tasks: readonly TaskListItem[];
}) {
  const dayNumber = String(Number(date.slice(8, 10)));
  const reachable = date >= MIN_ISO_DATE && date <= MAX_ISO_DATE;
  const spoken = ` – ${dayLabel(date)}, ${tasksCountText(tasks.length)}${isToday ? ", היום" : ""}${isSelected ? ", נבחר" : ""}`;
  const extra = tasks.length - MONTH_CELL_TITLES;
  return (
    <td
      className={cn(
        "border p-0 align-top",
        !inMonth && "bg-muted",
        isSelected && "outline-2 -outline-offset-2 outline-current",
      )}
    >
      {reachable ? (
        <Link
          href={calendarPath({ view: "month", date })}
          aria-current={isToday ? "date" : undefined}
          className={cn(
            "hover:bg-accent flex min-h-14 w-full flex-col items-stretch gap-0.5 p-1 text-sm md:min-h-24",
          )}
        >
          <span
            className={cn(
              "inline-flex size-6 items-center justify-center self-start rounded-full",
              isToday && "bg-primary text-primary-foreground font-bold",
              isSelected && !isToday && "font-bold underline",
            )}
          >
            {dayNumber}
          </span>
          <span className="sr-only">{spoken}</span>
          {tasks.length > 0 ? (
            <>
              <span aria-hidden="true" className="text-xs font-semibold md:hidden">
                {tasks.length}•
              </span>
              <span aria-hidden="true" className="hidden min-w-0 flex-col gap-0.5 md:flex">
                {tasks.slice(0, MONTH_CELL_TITLES).map((task) => (
                  <span
                    key={task.id}
                    className="truncate rounded-sm border border-dashed border-current px-1 text-xs"
                  >
                    {task.title}
                  </span>
                ))}
                {extra > 0 ? <span className="text-xs">+{extra} נוספות</span> : null}
              </span>
            </>
          ) : null}
        </Link>
      ) : null}
    </td>
  );
}
