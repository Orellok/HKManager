"use client";

import { useState } from "react";

import type { TaskReturnTarget } from "@/lib/tasks/paths";
import type { TaskListItem } from "@/lib/tasks/queries";

import { ToggleAnnouncement, useTaskDoneToggles } from "./task-done";
import { TaskRow } from "./task-row";

type TaskListProps = {
  tasks: readonly TaskListItem[];
  today: string;
  /** Id of the heading that names the list. */
  labelledBy: string;
  from?: TaskReturnTarget;
  showLinks?: boolean;
  /** Shown when the list was loaded empty. */
  emptyText: string;
};

/**
 * A plain list of tasks with their "בוצע" toggles (the dashboard card, the client and project
 * cards). The tasks are kept as they were loaded: when a toggle refreshes the page's data, a
 * task just marked done stays on screen (pressed) until the next visit, so it can be undone
 * in place. Its parent must keep rendering it after such a refresh, even when the refreshed
 * data has no tasks left, so it also shows its own empty state.
 */
export function TaskList({ tasks, today, labelledBy, from, showLinks, emptyText }: TaskListProps) {
  const [shown] = useState(tasks);
  const toggles = useTaskDoneToggles();
  if (shown.length === 0) {
    return <p className="text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      <ToggleAnnouncement announcement={toggles.announcement} />
      <ul aria-labelledby={labelledBy} className="divide-y rounded-lg border">
        {shown.map((task) => (
          <li key={task.id}>
            <TaskRow
              task={task}
              status={toggles.statusOf(task)}
              today={today}
              pending={toggles.isPending(task.id)}
              onToggle={() => toggles.toggle(task)}
              from={from}
              showLinks={showLinks}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
