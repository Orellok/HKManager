import Link from "next/link";

import { buttonClasses } from "@/components/button";
import type { ListPage } from "@/lib/paged-list";
import { TASKS_PATH } from "@/lib/tasks/paths";
import { CARD_TASKS_LIMIT, type TaskListItem } from "@/lib/tasks/queries";

import { TaskList } from "./task-list";

type CardTasksProps = {
  tasks: ListPage<TaskListItem>;
  today: string;
  /** The quick-create link, with the client or project filled in (TASK-8). */
  newTaskHref: string;
  from: "client" | "project";
};

const HEADING_ID = "card-tasks-heading";

/**
 * TASK-8: the open tasks of a client or a project on its card, with their "בוצע" toggles and
 * "משימה חדשה", which opens the form with the link filled in and returns here.
 */
export function CardTasks({ tasks, today, newTaskHref, from }: CardTasksProps) {
  return (
    <section aria-labelledby={HEADING_ID} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={HEADING_ID} className="text-xl font-semibold">
          משימות פתוחות
        </h2>
        <Link href={newTaskHref} className={buttonClasses("secondary")}>
          משימה חדשה
        </Link>
      </div>
      <TaskList
        tasks={tasks.items}
        today={today}
        labelledBy={HEADING_ID}
        from={from}
        showLinks={from === "client"}
        emptyText={from === "client" ? "אין משימות פתוחות ללקוח." : "אין משימות פתוחות לפרויקט."}
      />
      {tasks.hasMore ? (
        <p className="text-muted-foreground text-sm">
          מוצגות {CARD_TASKS_LIMIT} המשימות הקרובות. את כולן אפשר למצוא{" "}
          <Link href={TASKS_PATH} className="underline underline-offset-4">
            ברשימת המשימות
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
