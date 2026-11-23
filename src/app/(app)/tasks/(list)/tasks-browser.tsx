"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { Button, buttonClasses } from "@/components/button";
import { ToggleAnnouncement, useTaskDoneToggles } from "@/components/task-done";
import { TaskRow } from "@/components/task-row";
import { useGuardedTransition } from "@/components/use-guarded-transition";
import { useHydrated } from "@/components/use-hydrated";
import { callServerAction } from "@/lib/auth/action-failure";
import { appendPage, type ListPage, type PagedListState } from "@/lib/paged-list";
import { searchTasksAction } from "@/lib/tasks/actions";
import { groupOpenTasks } from "@/lib/tasks/grouping";
import { NEW_TASK_PATH, type TasksView } from "@/lib/tasks/paths";
import {
  FILTER_OPTIONS_LIMIT,
  NO_TASK_FILTER,
  OPEN_TASKS_LIMIT,
  type TaskFilterOptions,
  type TaskListFilter,
  type TaskListItem,
} from "@/lib/tasks/queries";
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, type TaskPriority } from "@/lib/tasks/status";

type TasksBrowserProps = {
  view: TasksView;
  today: string;
  filterOptions: TaskFilterOptions;
  initialPage: ListPage<TaskListItem>;
};

type ListState = PagedListState<TaskListItem, TaskListFilter>;

const FILTER_FAILED = "טעינת המשימות נכשלה. אפשר לנסות שוב.";
const LOAD_MORE_FAILED = "טעינת משימות נוספות נכשלה. אפשר לנסות שוב.";
const SELECT_CLASSES =
  "border-input bg-background min-h-11 w-full rounded-md border px-3 text-base";

function archivedLabel(name: string, archived: boolean): string {
  return archived ? `${name} (בארכיון)` : name;
}

function isFiltered(filter: TaskListFilter): boolean {
  return filter.priority !== "" || filter.clientId !== "" || filter.projectId !== "";
}

function countText(count: number): string {
  return count === 1 ? "משימה אחת" : `${count} משימות`;
}

/**
 * TASK-6 / TASK-7: the tasks list with its filters. The open tab groups the tasks (באיחור,
 * היום, מחר, בהמשך, ללא דדליין; by due date and then priority inside a group); the closed tab
 * lists done and cancelled tasks, last changed first, page by page. Filters by priority,
 * client and project apply on change through a Server Action (POST), so nothing chosen
 * appears in a URL; a change made while a load runs waits and replaces any other waiting one.
 * Choosing a project chooses its client; a client limits the projects to its own (TASK-9).
 */
export function TasksBrowser({ view, today, filterOptions, initialPage }: TasksBrowserProps) {
  const [state, setState] = useState<ListState>({
    ...initialPage,
    filter: NO_TASK_FILTER,
    searched: false,
  });
  const [filter, setFilter] = useState<TaskListFilter>(NO_TASK_FILTER);
  const queuedFilter = useRef<TaskListFilter | null>(null);
  const shownFilter = useRef<TaskListFilter>(NO_TASK_FILTER);
  const [error, setError] = useState<string | null>(null);
  const [filterPending, startFilter] = useGuardedTransition();
  const [morePending, startLoadMore] = useGuardedTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const focusItemAfterLoad = useRef<number | null>(null);
  const toggles = useTaskDoneToggles();
  const hydrated = useHydrated();
  const busy = filterPending || morePending;

  // "Load more" disappears with the last page; focus moves to the first new task instead.
  useEffect(() => {
    const index = focusItemAfterLoad.current;
    if (index === null) {
      return;
    }
    focusItemAfterLoad.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("li a")[index]?.focus();
  }, [state.items]);

  function applyFilter(next: TaskListFilter) {
    setFilter(next);
    queuedFilter.current = next;
    startFilter(async () => {
      let pendingFilter = queuedFilter.current;
      while (pendingFilter) {
        queuedFilter.current = null;
        const current = pendingFilter;
        setError(null);
        const call = await callServerAction(() =>
          searchTasksAction({ view, ...current, offset: 0 }),
        );
        if (call.status === "redirected") {
          return;
        }
        pendingFilter = queuedFilter.current;
        if (pendingFilter) {
          continue;
        }
        if (call.status === "failed" || !call.value.ok) {
          setFilter(shownFilter.current);
          setError(FILTER_FAILED);
          return;
        }
        shownFilter.current = current;
        toggles.forget();
        setState({ ...call.value.page, filter: current, searched: true });
      }
    });
  }

  function changePriority(event: ChangeEvent<HTMLSelectElement>) {
    applyFilter({ ...filter, priority: event.currentTarget.value as TaskPriority | "" });
  }

  function changeClient(event: ChangeEvent<HTMLSelectElement>) {
    const clientId = event.currentTarget.value;
    const project = filterOptions.projects.find((option) => option.id === filter.projectId);
    const keepProject =
      project !== undefined && (clientId === "" || project.client_id === clientId);
    applyFilter({ ...filter, clientId, projectId: keepProject ? filter.projectId : "" });
  }

  function changeProject(event: ChangeEvent<HTMLSelectElement>) {
    const projectId = event.currentTarget.value;
    const project = filterOptions.projects.find((option) => option.id === projectId);
    applyFilter({ ...filter, projectId, clientId: project ? project.client_id : filter.clientId });
  }

  function loadMore() {
    if (busy) {
      return;
    }
    const request = { filter: state.filter, offset: state.items.length };
    startLoadMore(async () => {
      setError(null);
      const call = await callServerAction(() =>
        searchTasksAction({ view, ...request.filter, offset: request.offset }),
      );
      if (call.status === "redirected") {
        return;
      }
      if (call.status === "failed" || !call.value.ok) {
        setError(LOAD_MORE_FAILED);
        return;
      }
      const { page } = call.value;
      if (!page.hasMore && page.items.length > 0) {
        focusItemAfterLoad.current = request.offset;
      }
      setState((previous) => appendPage(previous, request, page));
    });
  }

  const projectOptions = filterOptions.projects.filter(
    (option) => filter.clientId === "" || option.client_id === filter.clientId,
  );
  const filtered = isFiltered(state.filter);

  function renderRow(task: TaskListItem) {
    return (
      <li key={task.id}>
        <TaskRow
          task={task}
          status={toggles.statusOf(task)}
          today={today}
          pending={toggles.isPending(task.id)}
          onToggle={() => toggles.toggle(task)}
        />
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="סינון משימות"
        onSubmit={(event) => event.preventDefault()}
        className="grid gap-3 sm:grid-cols-3"
      >
        <div className="space-y-1.5">
          <label htmlFor="tasks-priority" className="block text-sm font-medium">
            עדיפות
          </label>
          <select
            id="tasks-priority"
            disabled={!hydrated}
            value={filter.priority}
            onChange={changePriority}
            className={SELECT_CLASSES}
          >
            <option value="">כל העדיפויות</option>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tasks-client" className="block text-sm font-medium">
            לקוח
          </label>
          <select
            id="tasks-client"
            disabled={!hydrated}
            value={filter.clientId}
            onChange={changeClient}
            className={SELECT_CLASSES}
          >
            <option value="">כל הלקוחות</option>
            {filterOptions.clients.map((client) => (
              <option key={client.id} value={client.id}>
                {archivedLabel(client.name, client.archived)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="tasks-project" className="block text-sm font-medium">
            פרויקט
          </label>
          <select
            id="tasks-project"
            disabled={!hydrated}
            value={filter.projectId}
            onChange={changeProject}
            aria-describedby="tasks-project-hint"
            className={SELECT_CLASSES}
          >
            <option value="">כל הפרויקטים</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {archivedLabel(project.name, project.archived)}
              </option>
            ))}
          </select>
          <p id="tasks-project-hint" className="text-muted-foreground text-sm">
            בחירת פרויקט בוחרת גם את הלקוח שלו.
          </p>
        </div>
        {filterOptions.hasMore ? (
          <p className="text-muted-foreground text-sm sm:col-span-3">
            בסינון מוצגים עד {FILTER_OPTIONS_LIMIT} לקוחות ו-{FILTER_OPTIONS_LIMIT} פרויקטים לפי שם.
          </p>
        ) : null}
      </form>

      <p role="status" className="sr-only">
        {state.searched
          ? `נמצאו ${countText(state.items.length)}${state.hasMore ? " ויותר" : ""}.`
          : ""}
      </p>
      <p role="alert" className="text-destructive text-sm font-medium">
        {error}
      </p>
      <ToggleAnnouncement announcement={toggles.announcement} />

      <div ref={listRef} aria-busy={filterPending} className="space-y-6">
        {state.items.length === 0 ? (
          <EmptyList view={view} filtered={filtered} />
        ) : view === "open" ? (
          groupOpenTasks(state.items, today).map((group) => {
            const headingId = `tasks-group-${group.key}`;
            return (
              <section key={group.key} aria-labelledby={headingId} className="space-y-2">
                <h2 id={headingId} className="text-lg font-semibold">
                  {group.label}{" "}
                  <span className="text-muted-foreground text-base font-normal">
                    ({group.tasks.length})
                  </span>
                </h2>
                <ul aria-labelledby={headingId} className="divide-y rounded-lg border">
                  {group.tasks.map(renderRow)}
                </ul>
              </section>
            );
          })
        ) : (
          <ul aria-label="משימות שבוצעו או בוטלו" className="divide-y rounded-lg border">
            {state.items.map(renderRow)}
          </ul>
        )}
      </div>

      {view === "open" && state.hasMore ? (
        <p className="text-muted-foreground text-sm">
          מוצגות {OPEN_TASKS_LIMIT} המשימות הראשונות לפי דדליין. אפשר לצמצם את הרשימה בסינון.
        </p>
      ) : null}
      {view === "closed" && state.hasMore ? (
        <Button variant="secondary" onClick={loadMore} pending={busy}>
          {morePending ? "טוען…" : "הצגת משימות נוספות"}
        </Button>
      ) : null}
    </div>
  );
}

function EmptyList({ view, filtered }: { view: TasksView; filtered: boolean }) {
  if (filtered) {
    return (
      <div className="space-y-2 rounded-lg border p-6 text-center">
        <p className="font-medium">אין משימות שמתאימות לסינון.</p>
        <p className="text-muted-foreground text-sm">אפשר לשנות את הסינון.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border p-6 text-center">
      <p className="font-medium">
        {view === "open" ? "אין משימות פתוחות." : "אין עדיין משימות שבוצעו או בוטלו."}
      </p>
      <p className="text-muted-foreground text-sm">
        {view === "open"
          ? "כאן יופיעו המשימות הפתוחות, לפי דדליין: באיחור, היום, מחר, בהמשך וללא דדליין."
          : "משימה שסומנה כבוצעה או בוטלה עוברת לכאן."}
      </p>
      {view === "open" ? (
        <Link href={NEW_TASK_PATH} className={buttonClasses("secondary")}>
          משימה חדשה
        </Link>
      ) : null}
    </div>
  );
}
