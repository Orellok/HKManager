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
};

/**
 * A plain list of tasks with their "בוצע" toggles (the dashboard card, the client and project
 * cards). The tasks are kept as they were loaded: when a toggle refreshes the page's data, a
 * task just marked done stays on screen (pressed) until the next visit, so it can be undone
 * in place.
 */
export function TaskList({ tasks, today, labelledBy, from, showLinks }: TaskListProps) {
  const [shown] = useState(tasks);
  const toggles = useTaskDoneToggles();
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
