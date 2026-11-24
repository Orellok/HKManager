import { clientPath } from "@/lib/clients/paths";
import { isIsoDate, isIsoDateInRange } from "@/lib/dates";
import { projectPath } from "@/lib/projects/paths";

import { CALENDAR_PATH, calendarPath, isCalendarView, type CalendarParams } from "./calendar";

export { CALENDAR_PATH };

/** Routes of the tasks screens. Only ids and fixed codes go into a URL (SPEC 8). */

export const TASKS_PATH = "/tasks";
export const NEW_TASK_PATH = "/tasks/new";

/** TASK-6: `?view=closed` shows the "בוצעו/בוטלו" tab. */
export const TASKS_VIEW_PARAM = "view";
export const CLOSED_TASKS_VIEW = "closed";
export const CLOSED_TASKS_PATH = `${TASKS_PATH}?${TASKS_VIEW_PARAM}=${CLOSED_TASKS_VIEW}`;

export type TasksView = "open" | "closed";

export function tasksViewFrom(param: unknown): TasksView {
  return param === CLOSED_TASKS_VIEW ? "closed" : "open";
}

/**
 * TASK-8: `?client=<id>` or `?project=<id>` opens the new-task form with the link filled in;
 * `?from=client|project` returns to that card after saving.
 */
export const TASK_CLIENT_PARAM = "client";
export const TASK_PROJECT_PARAM = "project";
export const TASK_FROM_PARAM = "from";

export const TASK_RETURN_TARGETS = ["tasks", "client", "project"] as const;
/**
 * Where a task form returns to: the list, the linked card, or (M7.1-12) the calendar view and
 * date it was opened from, written as `calendar:<view>:<date>` (a code and a date only).
 */
export type TaskReturnTarget =
  (typeof TASK_RETURN_TARGETS)[number] | `calendar:${CalendarParams["view"]}:${string}`;

const CALENDAR_RETURN_PREFIX = "calendar";

export function calendarReturnTarget({ view, date }: CalendarParams): TaskReturnTarget {
  return `${CALENDAR_RETURN_PREFIX}:${view}:${date}`;
}

/** The calendar view and date of a `calendar:<view>:<date>` target, or null. */
function calendarParamsOf(target: string): CalendarParams | null {
  const [prefix, view, date, ...rest] = target.split(":");
  if (
    prefix !== CALENDAR_RETURN_PREFIX ||
    rest.length > 0 ||
    !isCalendarView(view) ||
    date === undefined ||
    !isIsoDate(date) ||
    !isIsoDateInRange(date)
  ) {
    return null;
  }
  return { view, date };
}

export function taskReturnTargetFrom(param: unknown): TaskReturnTarget {
  if (param === "client" || param === "project") {
    return param;
  }
  const calendar = typeof param === "string" ? calendarParamsOf(param) : null;
  return calendar ? calendarReturnTarget(calendar) : "tasks";
}

export function newClientTaskPath(clientId: string): string {
  const query = new URLSearchParams({ [TASK_CLIENT_PARAM]: clientId, [TASK_FROM_PARAM]: "client" });
  return `${NEW_TASK_PATH}?${query}`;
}

export function newProjectTaskPath(projectId: string): string {
  const query = new URLSearchParams({
    [TASK_PROJECT_PARAM]: projectId,
    [TASK_FROM_PARAM]: "project",
  });
  return `${NEW_TASK_PATH}?${query}`;
}

export function editTaskPath(id: string, from: TaskReturnTarget = "tasks"): string {
  const path = `${TASKS_PATH}/${encodeURIComponent(id)}/edit`;
  return from === "tasks" ? path : `${path}?${new URLSearchParams({ [TASK_FROM_PARAM]: from })}`;
}

/** Where a saved or deleted task returns to: its client's or project's card, or the list. */
export function taskReturnPath(
  from: TaskReturnTarget,
  links: { clientId: string | null; projectId: string | null },
): string {
  if (from === "client" && links.clientId !== null) {
    return clientPath(links.clientId);
  }
  if (from === "project" && links.projectId !== null) {
    return projectPath(links.projectId);
  }
  const calendar = calendarParamsOf(from);
  return calendar ? calendarPath(calendar) : TASKS_PATH;
}
