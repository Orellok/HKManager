import Link from "next/link";

import { buttonClasses } from "@/components/button";
import { TaskList } from "@/components/task-list";
import { NEW_TASK_PATH, TASKS_PATH } from "@/lib/tasks/paths";
import type { TaskReminderCounts } from "@/lib/tasks/grouping";
import type { TaskListItem } from "@/lib/tasks/queries";

const HEADING_ID = "tasks-card-heading";
const LIST_HEADING_ID = "tasks-card-list-heading";

function tasksText(count: number): string {
  return count === 1 ? "משימה אחת" : `${count} משימות`;
}

/**
 * DASH-5 / NOTIF-2: the tasks card: how many open tasks are overdue, due today and due
 * tomorrow, and the first of them with their "בוצע" toggles (TASK-4). Counted from the data
 * on load (NOTIF-3).
 */
export function TasksCard({
  counts,
  tasks,
  today,
}: {
  counts: TaskReminderCounts;
  tasks: readonly TaskListItem[];
  today: string;
}) {
  const total = counts.overdue + counts.today + counts.tomorrow;
  const rows = [
    { key: "overdue", label: "באיחור", count: counts.overdue },
    { key: "today", label: "להיום", count: counts.today },
    { key: "tomorrow", label: "למחר", count: counts.tomorrow },
  ];
  return (
    <section
      aria-labelledby={HEADING_ID}
      className="space-y-3 rounded-lg border p-4 md:col-span-2 xl:col-span-3"
    >
      <h3 id={HEADING_ID} className="text-lg font-semibold">
        משימות
      </h3>
      <dl className="grid grid-cols-3 gap-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className="text-sm">{row.label}</dt>
            <dd className="text-3xl font-semibold">{row.count}</dd>
          </div>
        ))}
      </dl>
      {total === 0 ? (
        <p className="text-sm">אין משימות פתוחות באיחור, להיום או למחר.</p>
      ) : (
        <>
          <h4 id={LIST_HEADING_ID} className="text-sm font-medium">
            {total > tasks.length
              ? `${tasks.length} הראשונות מתוך ${tasksText(total)}, לפי דדליין`
              : "לפי דדליין"}
          </h4>
          <TaskList tasks={tasks} today={today} labelledBy={LIST_HEADING_ID} />
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Link href={TASKS_PATH} className={buttonClasses("primary")}>
          לכל המשימות
        </Link>
        <Link href={NEW_TASK_PATH} className={buttonClasses("secondary")}>
          משימה חדשה
        </Link>
      </div>
    </section>
  );
}

/** NOTIF-2: shown at the top of the dashboard while open tasks are overdue. */
export function OverdueTasksBanner({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="overdue-tasks-heading"
      className="bg-muted space-y-2 rounded-lg border-2 border-current p-4"
    >
      <h2 id="overdue-tasks-heading" className="font-semibold">
        {count === 1 ? "התראה: משימה אחת באיחור" : `התראה: ${count} משימות באיחור`}
      </h2>
      <Link href={TASKS_PATH} className={buttonClasses("secondary")}>
        לרשימת המשימות
      </Link>
    </section>
  );
}
