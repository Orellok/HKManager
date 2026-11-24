import type { SupabaseClient } from "@supabase/supabase-js";

import { rowIdAfterCreateKeyConflict } from "@/lib/create-key";
import { addDays } from "@/lib/dates";
import { countFromDb } from "@/lib/db-numbers";
import type { ListPage } from "@/lib/paged-list";

import type { TaskReminderCounts } from "./grouping";
import type { TaskInput } from "./schema";
import { isTaskPriority, isTaskStatus, type TaskPriority, type TaskStatus } from "./status";

/**
 * Data access for tasks (TASK-1..10, NOTIF-1..3, CAL-11). Every call runs with the caller's
 * session, so RLS applies; the callers (pages and Server Actions) check access with
 * requireAllowedUser() first. Every list is bounded.
 */

const TABLE = "tasks";

/** Open tasks read for the grouped list (TASK-6); more than this is said on the screen. */
export const OPEN_TASKS_LIMIT = 500;
/** Rows per page of the "בוצעו/בוטלו" tab. */
export const CLOSED_TASKS_PAGE_SIZE = 50;
/** Open tasks shown on a client or project card (TASK-8). */
export const CARD_TASKS_LIMIT = 50;
/** Tasks listed on the dashboard card (overdue, today, tomorrow; NOTIF-2). */
export const DASHBOARD_TASKS_LIMIT = 10;
/** Tasks read for one calendar range (at most 42 days, CAL-11). */
export const CALENDAR_TASKS_LIMIT = 500;
/** Active projects offered in the task form, by name. */
export const PROJECT_OPTIONS_LIMIT = 500;
/** Clients or projects offered in the list's filters (the RPCs return one more). */
export const FILTER_OPTIONS_LIMIT = 500;

/** Postgres foreign_key_violation: the client or project no longer exists. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by tasks_check_references(): TASK-9. */
const PROJECT_OF_OTHER_CLIENT = "HKT01";

/** Embedded names; the hints name the foreign keys so the embedding is never ambiguous. */
const LIST_COLUMNS =
  "id, title, due_date, priority, status, client_id, project_id, completed_at, created_at, client:clients!tasks_client_id_fkey(name), project:projects!tasks_project_id_fkey(name)";

export type Task = {
  id: string;
  title: string;
  description: string | null;
  /** ISO date or null (TASK-2). */
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  client_id: string | null;
  project_id: string | null;
};

export type TaskListItem = {
  id: string;
  title: string;
  due_date: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_name: string | null;
  /** ISO timestamp, set while done (TASK-4). */
  completed_at: string | null;
  created_at: string;
};

function priorityFromDb(value: unknown): TaskPriority {
  if (!isTaskPriority(value)) {
    throw new RangeError("The database returned an unknown task priority");
  }
  return value;
}

function statusFromDb(value: unknown): TaskStatus {
  if (!isTaskStatus(value)) {
    throw new RangeError("The database returned an unknown task status");
  }
  return value;
}

type Embedded = { name: string } | { name: string }[] | null;

function embeddedName(value: Embedded): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name ?? null;
}

type TaskListRow = Omit<TaskListItem, "priority" | "status" | "client_name" | "project_name"> & {
  priority: unknown;
  status: unknown;
  client: Embedded;
  project: Embedded;
};

function toListItem({ client, project, ...row }: TaskListRow): TaskListItem {
  return {
    ...row,
    priority: priorityFromDb(row.priority),
    status: statusFromDb(row.status),
    client_name: embeddedName(client),
    project_name: embeddedName(project),
  };
}

type TaskRow = Omit<Task, "priority" | "status"> & { priority: unknown; status: unknown };

/** One task that is not deleted, or null when it does not exist (or is not visible). */
export async function getTask(supabase: SupabaseClient, id: string): Promise<Task | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, title, description, due_date, priority, status, client_id, project_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<TaskRow>();
  if (error) {
    throw new Error("Could not read the task", { cause: error });
  }
  return data
    ? { ...data, priority: priorityFromDb(data.priority), status: statusFromDb(data.status) }
    : null;
}

/** Why the database refused to save a task. */
export type TaskRefusal = "project_of_other_client" | "reference_missing";

function refusalOf(code: string | undefined): TaskRefusal | null {
  if (code === PROJECT_OF_OTHER_CLIENT) {
    return "project_of_other_client";
  }
  return code === FOREIGN_KEY_VIOLATION ? "reference_missing" : null;
}

export type SaveTaskResult =
  | { status: "saved"; id: string }
  | { status: "not_found" }
  | { status: "refused"; refusal: TaskRefusal };

/** TASK-1: creates a task. M7.1-8: a repeated create key returns the task that key created. */
export async function insertTask(
  supabase: SupabaseClient,
  input: TaskInput,
  createKey: string | null = null,
): Promise<SaveTaskResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, create_key: createKey })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    const existingId = await rowIdAfterCreateKeyConflict(supabase, TABLE, error, createKey);
    if (existingId !== null) {
      return { status: "saved", id: existingId };
    }
    const refusal = refusalOf(error.code);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not create the task", { cause: error });
  }
  return { status: "saved", id: data.id };
}

/** TASK-1: saves changes to a task that is not deleted. */
export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  input: TaskInput,
): Promise<SaveTaskResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(input)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) {
    const refusal = refusalOf(error.code);
    if (refusal) {
      return { status: "refused", refusal };
    }
    throw new Error("Could not update the task", { cause: error });
  }
  return data.length > 0 ? { status: "saved", id } : { status: "not_found" };
}

export type DeleteTaskResult =
  | { status: "deleted"; clientId: string | null; projectId: string | null }
  | { status: "not_found" };

/** TASK-10: soft-deletes a task (the database stamps the time). */
export async function softDeleteTask(
  supabase: SupabaseClient,
  id: string,
): Promise<DeleteTaskResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("client_id, project_id");
  if (error) {
    throw new Error("Could not delete the task", { cause: error });
  }
  const row = (data as { client_id: string | null; project_id: string | null }[])[0];
  return row
    ? { status: "deleted", clientId: row.client_id, projectId: row.project_id }
    : { status: "not_found" };
}

export type SetTaskDoneResult = "changed" | "unchanged" | "cancelled" | "not_found";

const SET_DONE_RESULTS: readonly string[] = ["changed", "unchanged", "cancelled", "not_found"];

/** TASK-4: marks a task done, or open again, through set_task_done() (idempotent). */
export async function setTaskDone(
  supabase: SupabaseClient,
  id: string,
  done: boolean,
): Promise<SetTaskDoneResult> {
  const { data, error } = await supabase.rpc("set_task_done", { p_task_id: id, p_done: done });
  if (error) {
    throw new Error("Could not change the task's status", { cause: error });
  }
  if (typeof data !== "string" || !SET_DONE_RESULTS.includes(data)) {
    throw new Error("set_task_done returned an unexpected result");
  }
  return data as SetTaskDoneResult;
}

/** NOTIF-1 / NOTIF-2: open tasks overdue, due today and due tomorrow, for `today`. */
export async function getTaskReminderCounts(
  supabase: SupabaseClient,
  today: string,
): Promise<TaskReminderCounts> {
  const { data, error } = await supabase
    .rpc("task_reminder_counts", { p_today: today })
    .single<{ overdue: unknown; due_today: unknown; due_tomorrow: unknown }>();
  if (error) {
    throw new Error("Could not count the task reminders", { cause: error });
  }
  return {
    overdue: countFromDb(data.overdue),
    today: countFromDb(data.due_today),
    tomorrow: countFromDb(data.due_tomorrow),
  };
}

/** TASK-7: the list's filters; empty strings mean "all". */
export type TaskListFilter = {
  priority: TaskPriority | "";
  clientId: string;
  projectId: string;
};

export const NO_TASK_FILTER: TaskListFilter = { priority: "", clientId: "", projectId: "" };

// The builder's type is long and generic; the filters only chain .eq() calls.
type FilterableQuery<Query> = { eq: (column: string, value: string) => Query };

function applyFilter<Query extends FilterableQuery<Query>>(
  query: Query,
  filter: TaskListFilter,
): Query {
  let filtered = query;
  if (filter.priority !== "") {
    filtered = filtered.eq("priority", filter.priority);
  }
  if (filter.clientId !== "") {
    filtered = filtered.eq("client_id", filter.clientId);
  }
  if (filter.projectId !== "") {
    filtered = filtered.eq("project_id", filter.projectId);
  }
  return filtered;
}

/**
 * TASK-6 / TASK-7: the open tasks for the filter, by due date (none last), priority and age,
 * at most OPEN_TASKS_LIMIT; the caller groups them.
 */
export async function listOpenTasks(
  supabase: SupabaseClient,
  filter: TaskListFilter,
): Promise<ListPage<TaskListItem>> {
  const query = supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq("status", "open")
    .is("deleted_at", null);
  const { data, error } = await applyFilter(query, filter)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority_rank")
    .order("created_at")
    .order("id")
    .limit(OPEN_TASKS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the open tasks", { cause: error });
  }
  const rows = data as unknown as TaskListRow[];
  return {
    items: rows.slice(0, OPEN_TASKS_LIMIT).map(toListItem),
    hasMore: rows.length > OPEN_TASKS_LIMIT,
  };
}

/** TASK-6: one page of the done and cancelled tasks for the filter, last changed first. */
export async function listClosedTasks(
  supabase: SupabaseClient,
  filter: TaskListFilter,
  offset: number,
): Promise<ListPage<TaskListItem>> {
  const query = supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .neq("status", "open")
    .is("deleted_at", null);
  const { data, error } = await applyFilter(query, filter)
    .order("updated_at", { ascending: false })
    .order("id")
    // One extra row tells whether another page exists.
    .range(offset, offset + CLOSED_TASKS_PAGE_SIZE);
  if (error) {
    throw new Error("Could not list the closed tasks", { cause: error });
  }
  const rows = data as unknown as TaskListRow[];
  return {
    items: rows.slice(0, CLOSED_TASKS_PAGE_SIZE).map(toListItem),
    hasMore: rows.length > CLOSED_TASKS_PAGE_SIZE,
  };
}

/** TASK-8: the open tasks of a client or of a project, for its card. */
export async function listCardTasks(
  supabase: SupabaseClient,
  owner: { clientId: string } | { projectId: string },
): Promise<ListPage<TaskListItem>> {
  const column = "clientId" in owner ? "client_id" : "project_id";
  const value = "clientId" in owner ? owner.clientId : owner.projectId;
  const { data, error } = await supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq(column, value)
    .eq("status", "open")
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority_rank")
    .order("created_at")
    .order("id")
    .limit(CARD_TASKS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the card's tasks", { cause: error });
  }
  const rows = data as unknown as TaskListRow[];
  return {
    items: rows.slice(0, CARD_TASKS_LIMIT).map(toListItem),
    hasMore: rows.length > CARD_TASKS_LIMIT,
  };
}

/** NOTIF-2: the first open tasks that are overdue or due today or tomorrow. */
export async function listDashboardTasks(
  supabase: SupabaseClient,
  today: string,
): Promise<TaskListItem[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq("status", "open")
    .is("deleted_at", null)
    .lte("due_date", addDays(today, 1))
    .order("due_date")
    .order("priority_rank")
    .order("created_at")
    .order("id")
    .limit(DASHBOARD_TASKS_LIMIT);
  if (error) {
    throw new Error("Could not list the dashboard's tasks", { cause: error });
  }
  return (data as unknown as TaskListRow[]).map(toListItem);
}

/** CAL-11: the open tasks due from `from` to `to` (inclusive ISO dates). */
export async function listCalendarTasks(
  supabase: SupabaseClient,
  from: string,
  to: string,
): Promise<ListPage<TaskListItem>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .eq("status", "open")
    .is("deleted_at", null)
    .gte("due_date", from)
    .lte("due_date", to)
    .order("due_date")
    .order("priority_rank")
    .order("created_at")
    .order("id")
    .limit(CALENDAR_TASKS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list the calendar's tasks", { cause: error });
  }
  const rows = data as unknown as TaskListRow[];
  return {
    items: rows.slice(0, CALENDAR_TASKS_LIMIT).map(toListItem),
    hasMore: rows.length > CALENDAR_TASKS_LIMIT,
  };
}

export type ProjectOption = {
  id: string;
  name: string;
  client_id: string;
  client_name: string;
  archived: boolean;
};

type ProjectOptionRow = {
  id: string;
  name: string;
  client_id: string;
  archived_at: string | null;
  client: Embedded;
};

function toProjectOption(row: ProjectOptionRow): ProjectOption {
  return {
    id: row.id,
    name: row.name,
    client_id: row.client_id,
    client_name: embeddedName(row.client) ?? "",
    archived: row.archived_at !== null,
  };
}

const PROJECT_OPTION_COLUMNS =
  "id, name, client_id, archived_at, client:clients!projects_client_id_fkey(name)";

/**
 * TASK-9: the projects the task form offers: the active ones, by name, plus `selectedId`
 * when it is not among them (an archived project of an edited task). Each names its client,
 * so choosing a project fills the client and a client limits the projects.
 */
export async function listTaskProjectOptions(
  supabase: SupabaseClient,
  selectedId: string | null,
): Promise<{ options: ProjectOption[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_OPTION_COLUMNS)
    .is("archived_at", null)
    .order("name")
    .order("id")
    .limit(PROJECT_OPTIONS_LIMIT + 1);
  if (error) {
    throw new Error("Could not list projects for the task form", { cause: error });
  }
  const rows = data as unknown as ProjectOptionRow[];
  const options = rows.slice(0, PROJECT_OPTIONS_LIMIT).map(toProjectOption);
  if (selectedId !== null && !options.some((option) => option.id === selectedId)) {
    const extra = await supabase
      .from("projects")
      .select(PROJECT_OPTION_COLUMNS)
      .eq("id", selectedId)
      .maybeSingle<ProjectOptionRow>();
    if (extra.error) {
      throw new Error("Could not read the selected project", { cause: extra.error });
    }
    if (extra.data) {
      options.push(toProjectOption(extra.data));
    }
  }
  return { options, hasMore: rows.length > PROJECT_OPTIONS_LIMIT };
}

/** The client of a project, or null when the project does not exist (or is not visible). */
export async function getProjectClientId(
  supabase: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("client_id")
    .eq("id", projectId)
    .maybeSingle<{ client_id: string }>();
  if (error) {
    throw new Error("Could not read the project's client", { cause: error });
  }
  return data?.client_id ?? null;
}

export type FilterClientOption = { id: string; name: string; archived: boolean };
export type FilterProjectOption = FilterClientOption & { client_id: string };

export type TaskFilterOptions = {
  clients: FilterClientOption[];
  projects: FilterProjectOption[];
  /** More clients or projects exist than FILTER_OPTIONS_LIMIT. */
  hasMore: boolean;
};

/** TASK-7: the clients and projects named by tasks, for the list's filters. */
export async function listTaskFilterOptions(supabase: SupabaseClient): Promise<TaskFilterOptions> {
  const [clients, projects] = await Promise.all([
    supabase.rpc("task_filter_clients"),
    supabase.rpc("task_filter_projects"),
  ]);
  const error = clients.error ?? projects.error;
  if (error) {
    throw new Error("Could not list the task filter options", { cause: error });
  }
  const clientRows = (clients.data ?? []) as FilterClientOption[];
  const projectRows = (projects.data ?? []) as FilterProjectOption[];
  return {
    clients: clientRows.slice(0, FILTER_OPTIONS_LIMIT),
    projects: projectRows.slice(0, FILTER_OPTIONS_LIMIT),
    hasMore: clientRows.length > FILTER_OPTIONS_LIMIT || projectRows.length > FILTER_OPTIONS_LIMIT,
  };
}
