"use client";

import Link from "next/link";

import { formatIsoDate } from "@/lib/dates";
import { isOverdue } from "@/lib/tasks/grouping";
import { editTaskPath, type TaskReturnTarget } from "@/lib/tasks/paths";
import type { TaskListItem } from "@/lib/tasks/queries";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

import { TaskDoneButton } from "./task-done";

type TaskRowProps = {
  task: TaskListItem;
  /** The task's status now (after a toggle on this screen). */
  status: TaskStatus;
  /** Today in Asia/Jerusalem, from the server (TASK-3: overdue is computed). */
  today: string;
  pending: boolean;
  onToggle: () => void;
  /** Where the edit form returns to. */
  from?: TaskReturnTarget;
  /** The calendar already places a task on its date. */
  showDueDate?: boolean;
  /** A card already names its client or project. */
  showLinks?: boolean;
  /** From the md breakpoint, the toggle under the text (the calendar's week columns). */
  stacked?: boolean;
};

/** A pill may wrap inside a narrow column (the calendar's week view) rather than overflow it. */
const PILL_CLASSES =
  "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs wrap-anywhere";

/**
 * One task: its title (a link to its edit form), due date, priority, client and project, and
 * the "בוצע" toggle (TASK-4). Overdue (TASK-3) and a high or low priority are written out as
 * text in pills, so nothing is told by color alone.
 */
export function TaskRow({
  task,
  status,
  today,
  pending,
  onToggle,
  from = "tasks",
  showDueDate = true,
  showLinks = true,
  stacked = false,
}: TaskRowProps) {
  const overdue = isOverdue({ due_date: task.due_date, status }, today);
  const links = [task.client_name, task.project_name].filter(Boolean).join(" · ");
  const closed = status !== "open";
  return (
    <div
      className={cn(
        "flex gap-3 py-2",
        "items-start justify-between px-4",
        stacked && "md:flex-col md:justify-start md:px-2",
      )}
    >
      <div className="min-w-0 space-y-1">
        <Link
          href={editTaskPath(task.id, from)}
          className={cn(
            "inline-flex min-h-11 items-center font-medium underline-offset-4 wrap-anywhere hover:underline",
            closed && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </Link>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {closed ? (
            <span className="text-foreground font-medium">{TASK_STATUS_LABELS[status]}</span>
          ) : null}
          {overdue ? (
            <span
              className={cn(PILL_CLASSES, "text-foreground border-2 border-current font-medium")}
            >
              באיחור
            </span>
          ) : null}
          {showDueDate ? (
            <span>
              {task.due_date === null ? "ללא דדליין" : `דדליין: ${formatIsoDate(task.due_date)}`}
            </span>
          ) : null}
          {task.priority !== "normal" ? (
            <span className={cn(PILL_CLASSES, "text-foreground bg-muted border")}>
              עדיפות {TASK_PRIORITY_LABELS[task.priority]}
            </span>
          ) : null}
          {showLinks && links ? <span className="wrap-anywhere">{links}</span> : null}
        </p>
      </div>
      {status === "cancelled" ? null : (
        <TaskDoneButton
          title={task.title}
          done={status === "done"}
          pending={pending}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}
