import { addDays } from "@/lib/dates";

import { TASK_PRIORITY_RANK, type TaskPriority, type TaskStatus } from "./status";

/**
 * TASK-3 / TASK-6: what is computed from a task's due date and "today" (an ISO date in
 * Asia/Jerusalem, todayInJerusalem(), so the groups turn at local midnight all year, DST
 * included). Due dates are calendar dates compared as ISO strings; no time of day is involved.
 */

/** The fields grouping and sorting need. */
export type GroupableTask = {
  id: string;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  /** ISO timestamp; the last tie-breaker before the id. */
  created_at: string;
};

export const TASK_GROUP_KEYS = ["overdue", "today", "tomorrow", "later", "no_due_date"] as const;
export type TaskGroupKey = (typeof TASK_GROUP_KEYS)[number];

/** TASK-6: the groups of the open list, in this order. */
export const TASK_GROUP_LABELS: Record<TaskGroupKey, string> = {
  overdue: "באיחור",
  today: "היום",
  tomorrow: "מחר",
  later: "בהמשך",
  no_due_date: "ללא דדליין",
};

/** TASK-3: an open task whose due date is before today. Never stored. */
export function isOverdue(
  task: Pick<GroupableTask, "due_date" | "status">,
  today: string,
): boolean {
  return task.status === "open" && task.due_date !== null && task.due_date < today;
}

/** TASK-6: the group of an open task by its due date. */
export function taskGroupOf(dueDate: string | null, today: string): TaskGroupKey {
  if (dueDate === null) {
    return "no_due_date";
  }
  if (dueDate < today) {
    return "overdue";
  }
  if (dueDate === today) {
    return "today";
  }
  return dueDate === addDays(today, 1) ? "tomorrow" : "later";
}

/**
 * TASK-6: by due date (earliest first, none last), then priority (high first), then the
 * oldest created, then the id, so the order is total and stable.
 */
export function compareTasks(first: GroupableTask, second: GroupableTask): number {
  if (first.due_date !== second.due_date) {
    if (first.due_date === null) {
      return 1;
    }
    if (second.due_date === null) {
      return -1;
    }
    return first.due_date < second.due_date ? -1 : 1;
  }
  const byPriority = TASK_PRIORITY_RANK[first.priority] - TASK_PRIORITY_RANK[second.priority];
  if (byPriority !== 0) {
    return byPriority;
  }
  if (first.created_at !== second.created_at) {
    return first.created_at < second.created_at ? -1 : 1;
  }
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

export type TaskGroup<Task> = { key: TaskGroupKey; label: string; tasks: Task[] };

/** TASK-6: the non-empty groups of the given open tasks, in group order, each sorted. */
export function groupOpenTasks<Task extends GroupableTask>(
  tasks: readonly Task[],
  today: string,
): TaskGroup<Task>[] {
  const byGroup = new Map<TaskGroupKey, Task[]>();
  for (const task of tasks) {
    const key = taskGroupOf(task.due_date, today);
    const list = byGroup.get(key) ?? [];
    list.push(task);
    byGroup.set(key, list);
  }
  return TASK_GROUP_KEYS.filter((key) => byGroup.has(key)).map((key) => ({
    key,
    label: TASK_GROUP_LABELS[key],
    tasks: [...(byGroup.get(key) ?? [])].sort(compareTasks),
  }));
}

/** NOTIF-1 / NOTIF-2: the open tasks that are overdue, due today and due tomorrow. */
export type TaskReminderCounts = { overdue: number; today: number; tomorrow: number };

export const NO_TASK_REMINDERS: TaskReminderCounts = { overdue: 0, today: 0, tomorrow: 0 };

/** NOTIF-1: the navigation badge counts the overdue tasks and today's. */
export function badgeCount(counts: TaskReminderCounts): number {
  return counts.overdue + counts.today;
}

/** NOTIF-1: what a screen reader hears after the item's name, e.g. ", 3 לטיפול"; "" for 0. */
export function badgeSpokenSuffix(count: number, kind: "tasks" | "more"): string {
  if (count <= 0) {
    return "";
  }
  if (kind === "tasks") {
    return `, ${count} לטיפול`;
  }
  return count === 1 ? ", משימה אחת לטיפול" : `, ${count} משימות לטיפול`;
}

/** The number shown in the badge; very large counts are capped so the pill keeps its size. */
export const BADGE_DISPLAY_MAX = 99;

export function badgeDisplayText(count: number): string {
  return count > BADGE_DISPLAY_MAX ? `${BADGE_DISPLAY_MAX}+` : String(count);
}
