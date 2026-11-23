/**
 * Task priorities and statuses (TASK-1, TASK-3). The database repeats both lists as check
 * constraints. "Overdue" is not a status: it is computed (see grouping.ts).
 */

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** TASK-1: the default priority. */
export const DEFAULT_TASK_PRIORITY: TaskPriority = "normal";

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "גבוהה",
  normal: "רגילה",
  low: "נמוכה",
};

/** High first (TASK-6: within a group, by due date and then priority). */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = { high: 1, normal: 2, low: 3 };

export const TASK_STATUSES = ["open", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: "פתוחה",
  done: "בוצעה",
  cancelled: "בוטלה",
};

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
