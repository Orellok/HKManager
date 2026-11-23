import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  NO_TASK_FILTER,
  getTask,
  getTaskReminderCounts,
  insertTask,
  listCalendarTasks,
  listCardTasks,
  listClosedTasks,
  listOpenTasks,
  listTaskFilterOptions,
  setTaskDone,
  softDeleteTask,
  updateTask,
} from "@/lib/tasks/queries";
import type { TaskInput } from "@/lib/tasks/schema";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  testEmail,
  type TestUser,
} from "./support/local-supabase";
import { runPsqlSession } from "./support/psql-session";

const TABLE = "tasks";
const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
/** Raised by tasks_check_references(): TASK-9. */
const PROJECT_OF_OTHER_CLIENT = "HKT01";
/** Every task, client and project this file creates has this marker in its name or title. */
const MARKER = `it-tasks-${randomUUID()}`;
/** A "today" no other data uses, for the reminder counts (NOTIF-1/2). */
const COUNT_TODAY = "1901-06-15";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  client_id: string | null;
  project_id: string | null;
  completed_at: string | null;
  deleted_at: string | null;
  created_by: string | null;
};

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
const createdUserIds: string[] = [];

function uniqueName(label: string): string {
  return `${label} ${MARKER} ${randomUUID().slice(0, 8)}`;
}

function taskInput(fields: Partial<TaskInput> = {}): TaskInput {
  return {
    title: uniqueName("משימה"),
    due_date: null,
    priority: "normal",
    client_id: null,
    project_id: null,
    description: null,
    status: "open",
    ...fields,
  };
}

async function insertClient(fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("clients")
    .insert({ name: uniqueName("לקוח"), ...fields })
    .select("id, name")
    .single<{ id: string; name: string }>();
  if (error) {
    throw new Error("Could not insert a test client", { cause: error });
  }
  return data;
}

async function insertProject(clientId: string, fields: Record<string, unknown> = {}) {
  const { data, error } = await service
    .from("projects")
    .insert({ client_id: clientId, name: uniqueName("פרויקט"), ...fields })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test project", { cause: error });
  }
  return data;
}

/** Inserts a task as the service role and returns its id. */
async function insertAsService(fields: Partial<TaskInput> & Record<string, unknown> = {}) {
  const { data, error } = await service
    .from(TABLE)
    .insert(taskInput(fields))
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error("Could not insert a test task", { cause: error });
  }
  return data.id;
}

async function readTask(id: string): Promise<TaskRow> {
  const { data, error } = await service.from(TABLE).select().eq("id", id).single<TaskRow>();
  if (error) {
    throw new Error("Could not read the task", { cause: error });
  }
  return data;
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("tasks-outsider"));
  createdUserIds.push(outsider.id);
  owner = await createSignedInUser(service, testEmail("tasks-owner"));
  createdUserIds.push(owner.id);
  admin = await createSignedInUser(service, testEmail("tasks-admin"));
  createdUserIds.push(admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const cleanupErrors: unknown[] = [];
  const { data: clients } = await service.from("clients").select("id").like("name", `%${MARKER}%`);
  const clientIds = (clients ?? []).map((row) => row.id as string);
  const tasks = await service
    .from(TABLE)
    .delete()
    .or(
      [`title.like.%${MARKER}%`, ...(clientIds.length ? [`client_id.in.(${clientIds})`] : [])].join(
        ",",
      ),
    );
  const projects = await service.from("projects").delete().like("name", `%${MARKER}%`);
  const removedClients = await service.from("clients").delete().like("name", `%${MARKER}%`);
  const allowlist = await service
    .from("allowed_users")
    .delete()
    .in("email", [owner?.email, admin?.email].filter(Boolean));
  cleanupErrors.push(
    ...[tasks.error, projects.error, removedClients.error, allowlist.error].filter(Boolean),
  );
  for (const id of createdUserIds) {
    try {
      await deleteUser(service, id);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error("Cleanup failed", { cause: cleanupErrors });
  }
});

describe("AUTH-4 / TASK-5: row level security on tasks", () => {
  it("TASK-5: anon cannot read or write tasks", async () => {
    const id = await insertAsService();
    const read = await anon.from(TABLE).select("id").eq("id", id);
    expect(read.error?.code ?? (read.data ?? []).length).toBeTruthy();
    expect(read.data ?? []).toEqual([]);
    const write = await anon.from(TABLE).insert(taskInput());
    expect(write.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("TASK-5: a signed-in user outside the allowlist sees no task and cannot write one", async () => {
    const id = await insertAsService();
    const read = await outsider.client.from(TABLE).select("id").eq("id", id);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const insert = await insertTask(outsider.client, taskInput()).catch((error: Error) => error);
    expect(insert).toBeInstanceOf(Error);
    expect(((insert as Error).cause as { code?: string }).code).toBe(INSUFFICIENT_PRIVILEGE);
    const update = await updateTask(outsider.client, id, taskInput({ title: "x" }));
    expect(update).toEqual({ status: "not_found" });
    expect(await setTaskDone(outsider.client, id, true)).toBe("not_found");
    expect((await readTask(id)).status).toBe("open");
  });

  it("TASK-5: owner and admin both create, read and edit every task (no assignee)", async () => {
    const created = await insertTask(owner.client, taskInput({ title: uniqueName("של הבעלים") }));
    expect(created.status).toBe("saved");
    const id = (created as { id: string }).id;
    expect((await readTask(id)).created_by).toBe(owner.id);
    const asAdmin = await getTask(admin.client, id);
    expect(asAdmin?.id).toBe(id);
    const edited = await updateTask(
      admin.client,
      id,
      taskInput({ title: uniqueName("נערכה"), priority: "high", due_date: "2026-12-01" }),
    );
    expect(edited).toEqual({ status: "saved", id });
    expect(await getTask(owner.client, id)).toMatchObject({
      priority: "high",
      due_date: "2026-12-01",
    });
  });

  it("TASK-10: no one but the service role can delete a task physically", async () => {
    const id = await insertAsService();
    for (const user of [owner, admin]) {
      const { error } = await user.client.from(TABLE).delete().eq("id", id);
      expect(error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect((await readTask(id)).id).toBe(id);
  });

  it("TASK-1: the database repeats the form's rules", async () => {
    const tooLong = await owner.client.from(TABLE).insert(taskInput({ title: "א".repeat(201) }));
    expect(tooLong.error?.code).toBe(CHECK_VIOLATION);
    const untrimmed = await owner.client.from(TABLE).insert(taskInput({ title: " רווח " }));
    expect(untrimmed.error?.code).toBe(CHECK_VIOLATION);
    const priority = await service.from(TABLE).insert({ ...taskInput(), priority: "urgent" });
    expect(priority.error?.code).toBe(CHECK_VIOLATION);
    const status = await service.from(TABLE).insert({ ...taskInput(), status: "overdue" });
    expect(status.error?.code).toBe(CHECK_VIOLATION);
    const date = await service.from(TABLE).insert(taskInput({ due_date: "2101-01-01" }));
    expect(date.error?.code).toBe(CHECK_VIOLATION);
    // TASK-1: default priority normal and status open.
    const { data } = await service
      .from(TABLE)
      .insert({ title: uniqueName("ברירות מחדל") })
      .select("priority, status, due_date")
      .single();
    expect(data).toEqual({ priority: "normal", status: "open", due_date: null });
  });
});

describe("TASK-4 / TASK-10: times set by the database", () => {
  it("TASK-4: completed_at is set when a task is done, kept while done, cleared otherwise", async () => {
    const id = await insertAsService();
    expect((await readTask(id)).completed_at).toBeNull();
    expect(await setTaskDone(owner.client, id, true)).toBe("changed");
    const done = await readTask(id);
    expect(done.status).toBe("done");
    expect(done.completed_at).not.toBeNull();
    // An edit of a done task keeps the time it was completed.
    await sleep(20);
    await updateTask(
      owner.client,
      id,
      taskInput({ title: uniqueName("עדיין בוצעה"), status: "done" }),
    );
    expect((await readTask(id)).completed_at).toBe(done.completed_at);
    expect(await setTaskDone(owner.client, id, false)).toBe("changed");
    expect(await readTask(id)).toMatchObject({ status: "open", completed_at: null });
    await updateTask(
      owner.client,
      id,
      taskInput({ title: uniqueName("בוטלה"), status: "cancelled" }),
    );
    expect(await readTask(id)).toMatchObject({ status: "cancelled", completed_at: null });
    // A task created as done gets the time too.
    const createdDone = await insertAsService({ status: "done" });
    expect((await readTask(createdDone)).completed_at).not.toBeNull();
  });

  it("TASK-4: users cannot write completed_at; even the service role cannot fake it", async () => {
    const id = await insertAsService();
    const direct = await owner.client
      .from(TABLE)
      .update({ completed_at: "2000-01-01T00:00:00Z" })
      .eq("id", id);
    expect(direct.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    await service.from(TABLE).update({ completed_at: "2000-01-01T00:00:00Z" }).eq("id", id);
    expect((await readTask(id)).completed_at).toBeNull();
  });

  it("TASK-10: a soft delete is stamped with the database time and the task can no longer change", async () => {
    const id = await insertAsService();
    const before = Date.now();
    const { error } = await owner.client
      .from(TABLE)
      .update({ deleted_at: "1999-01-01T00:00:00Z" })
      .eq("id", id);
    expect(error).toBeNull();
    const deleted = await readTask(id);
    expect(new Date(deleted.deleted_at ?? 0).getTime()).toBeGreaterThan(before - 60_000);
    expect(await getTask(owner.client, id)).toBeNull();
    expect(await updateTask(owner.client, id, taskInput())).toEqual({ status: "not_found" });
    expect(await softDeleteTask(owner.client, id)).toEqual({ status: "not_found" });
    expect(await setTaskDone(owner.client, id, true)).toBe("not_found");
    const undelete = await owner.client
      .from(TABLE)
      .update({ deleted_at: null })
      .eq("id", id)
      .select("id");
    expect(undelete.data).toEqual([]);
    expect((await readTask(id)).deleted_at).toBe(deleted.deleted_at);
  });

  it("TASK-10: softDeleteTask returns the task's client and project for the return path", async () => {
    const client = await insertClient();
    const project = await insertProject(client.id);
    const id = await insertAsService({ client_id: client.id, project_id: project.id });
    expect(await softDeleteTask(admin.client, id)).toEqual({
      status: "deleted",
      clientId: client.id,
      projectId: project.id,
    });
  });
});

describe("TASK-4: set_task_done is idempotent and race-safe", () => {
  it("TASK-4: results for changed, unchanged, cancelled and unknown tasks", async () => {
    const id = await insertAsService();
    expect(await setTaskDone(owner.client, id, false)).toBe("unchanged");
    expect(await setTaskDone(owner.client, id, true)).toBe("changed");
    expect(await setTaskDone(admin.client, id, true)).toBe("unchanged");
    const cancelled = await insertAsService({ status: "cancelled" });
    expect(await setTaskDone(owner.client, cancelled, true)).toBe("cancelled");
    expect((await readTask(cancelled)).status).toBe("cancelled");
    expect(await setTaskDone(owner.client, randomUUID(), true)).toBe("not_found");
  });

  it("TASK-4: two users marking the same task done at once: one changes it, the other finds it done", async () => {
    const id = await insertAsService();
    const results = await Promise.all([
      setTaskDone(owner.client, id, true),
      setTaskDone(admin.client, id, true),
      setTaskDone(owner.client, id, true),
    ]);
    expect(results.filter((result) => result === "changed")).toHaveLength(1);
    expect(results.filter((result) => result === "unchanged")).toHaveLength(2);
    expect((await readTask(id)).status).toBe("done");
  });

  it("TASK-4: a toggle waits for a concurrent edit that holds the row, then sees its result", async () => {
    const id = await insertAsService();
    const edit = runPsqlSession(`
      begin;
      update public.tasks set status = 'done' where id = '${id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    // The second writer asks for "done" too: after the wait it finds the task done already.
    expect(await setTaskDone(owner.client, id, true)).toBe("unchanged");
    expect(await edit).toEqual({ ok: true });
  });
});

describe("TASK-9: a task's project belongs to its client", () => {
  it("TASK-9: a project of another client is refused for every writer (HKT01)", async () => {
    const client = await insertClient();
    const other = await insertClient();
    const project = await insertProject(other.id);
    const input = taskInput({ client_id: client.id, project_id: project.id });
    expect(await insertTask(owner.client, input)).toEqual({
      status: "refused",
      refusal: "project_of_other_client",
    });
    const asService = await service.from(TABLE).insert(input);
    expect(asService.error?.code).toBe(PROJECT_OF_OTHER_CLIENT);
    // Changing an existing task to another client's project is refused as well.
    const id = await insertAsService({ client_id: client.id });
    expect(await updateTask(owner.client, id, input)).toEqual({
      status: "refused",
      refusal: "project_of_other_client",
    });
    // Its own client's project is accepted.
    expect(
      await updateTask(
        owner.client,
        id,
        taskInput({ client_id: other.id, project_id: project.id }),
      ),
    ).toEqual({ status: "saved", id });
  });

  it("TASK-9: a project without its client is refused; a client alone is fine", async () => {
    const client = await insertClient();
    const project = await insertProject(client.id);
    // The trigger runs before the check constraint, so it reports the mismatch first.
    const noClient = await service.from(TABLE).insert(taskInput({ project_id: project.id }));
    expect(noClient.error?.code).toBe(PROJECT_OF_OTHER_CLIENT);
    // The constraint still holds alone for a project that no longer exists to compare with.
    const ghost = await service.from(TABLE).insert(taskInput({ project_id: randomUUID() }));
    expect([CHECK_VIOLATION, FOREIGN_KEY_VIOLATION]).toContain(ghost.error?.code);
    expect((await insertTask(owner.client, taskInput({ client_id: client.id }))).status).toBe(
      "saved",
    );
    expect(await insertTask(owner.client, taskInput({ client_id: randomUUID() }))).toEqual({
      status: "refused",
      refusal: "reference_missing",
    });
    const missingProject = await service
      .from(TABLE)
      .insert(taskInput({ client_id: client.id, project_id: randomUUID() }));
    expect(missingProject.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("TASK-9: a project that moves to another client takes its tasks along, deleted ones too", async () => {
    const client = await insertClient();
    const other = await insertClient();
    const project = await insertProject(client.id);
    const open = await insertAsService({ client_id: client.id, project_id: project.id });
    const deleted = await insertAsService({ client_id: client.id, project_id: project.id });
    await service.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", deleted);
    const unrelated = await insertAsService({ client_id: client.id });

    const { error } = await owner.client
      .from("projects")
      .update({ client_id: other.id })
      .eq("id", project.id);
    expect(error).toBeNull();
    expect((await readTask(open)).client_id).toBe(other.id);
    expect((await readTask(deleted)).client_id).toBe(other.id);
    expect((await readTask(unrelated)).client_id).toBe(client.id);
  });

  it("TASK-9: a task written while its project moves waits and is then checked against the new client", async () => {
    const client = await insertClient();
    const other = await insertClient();
    const project = await insertProject(client.id);
    const move = runPsqlSession(`
      begin;
      update public.projects set client_id = '${other.id}' where id = '${project.id}';
      select pg_sleep(1.5);
      commit;
    `);
    await sleep(500);
    const task = runPsqlSession(`
      insert into public.tasks (title, client_id, project_id)
      values ('${uniqueName("במקביל")}', '${client.id}', '${project.id}');
    `);
    expect(await move).toEqual({ ok: true });
    expect(await task).toMatchObject({ ok: false, sqlState: PROJECT_OF_OTHER_CLIENT });
  });
});

describe("TASK-10: archiving keeps tasks; a client or project with tasks is not deleted", () => {
  it("TASK-10: archiving the client and the project leaves their tasks as they were", async () => {
    const client = await insertClient();
    const project = await insertProject(client.id);
    const id = await insertAsService({
      client_id: client.id,
      project_id: project.id,
      due_date: "2026-12-24",
    });
    const before = await readTask(id);
    const archivedAt = new Date().toISOString();
    expect(
      (await owner.client.from("projects").update({ archived_at: archivedAt }).eq("id", project.id))
        .error,
    ).toBeNull();
    expect(
      (await owner.client.from("clients").update({ archived_at: archivedAt }).eq("id", client.id))
        .error,
    ).toBeNull();
    expect(await readTask(id)).toEqual(before);
    expect(
      (await listCardTasks(owner.client, { clientId: client.id })).items.map((t) => t.id),
    ).toEqual([id]);
    expect(
      (await listCardTasks(owner.client, { projectId: project.id })).items.map((t) => t.id),
    ).toEqual([id]);
    // A task can still be added to, and edited for, an archived client and project.
    expect(
      (await insertTask(owner.client, taskInput({ client_id: client.id, project_id: project.id })))
        .status,
    ).toBe("saved");
  });

  it("TASK-10: a client or project with tasks cannot be deleted (only archived)", async () => {
    const client = await insertClient();
    const project = await insertProject(client.id);
    await insertAsService({ client_id: client.id, project_id: project.id });
    const projectDelete = await owner.client.from("projects").delete().eq("id", project.id);
    expect(projectDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
    const clientOnly = await insertClient();
    await insertAsService({ client_id: clientOnly.id });
    const clientDelete = await owner.client.from("clients").delete().eq("id", clientOnly.id);
    expect(clientDelete.error?.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("NOTIF-1 / NOTIF-2 / NOTIF-3: reminder counts computed from the data", () => {
  it("NOTIF-1: overdue, today and tomorrow count open tasks only; no due date never counts", async () => {
    const before = await getTaskReminderCounts(owner.client, COUNT_TODAY);
    await insertAsService({ due_date: "1901-06-14" });
    await insertAsService({ due_date: "1901-01-01" });
    await insertAsService({ due_date: "1901-06-15" });
    await insertAsService({ due_date: "1901-06-16" });
    await insertAsService({ due_date: "1901-06-17" });
    await insertAsService({ due_date: null });
    await insertAsService({ due_date: "1901-06-14", status: "done" });
    await insertAsService({ due_date: "1901-06-15", status: "cancelled" });
    const deleted = await insertAsService({ due_date: "1901-06-15" });
    await service.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq("id", deleted);

    const after = await getTaskReminderCounts(owner.client, COUNT_TODAY);
    expect({
      overdue: after.overdue - before.overdue,
      today: after.today - before.today,
      tomorrow: after.tomorrow - before.tomorrow,
    }).toEqual({ overdue: 2, today: 1, tomorrow: 1 });
    // RLS: an outsider counts nothing.
    expect(await getTaskReminderCounts(outsider.client, COUNT_TODAY)).toEqual({
      overdue: 0,
      today: 0,
      tomorrow: 0,
    });
  });
});

describe("TASK-6 / TASK-7 / CAL-11: lists", () => {
  it("TASK-6 / TASK-7: the open list holds open tasks only and filters by priority, client and project", async () => {
    const client = await insertClient();
    const project = await insertProject(client.id);
    const high = await insertAsService({
      client_id: client.id,
      project_id: project.id,
      priority: "high",
      due_date: "2026-12-02",
    });
    const low = await insertAsService({
      client_id: client.id,
      priority: "low",
      due_date: "2026-12-01",
    });
    const done = await insertAsService({ client_id: client.id, status: "done" });

    const byClient = await listOpenTasks(owner.client, { ...NO_TASK_FILTER, clientId: client.id });
    expect(byClient.items.map((item) => item.id)).toEqual([low, high]);
    expect(byClient.items[1]).toMatchObject({
      client_name: client.name,
      project_id: project.id,
      priority: "high",
    });
    const byProject = await listOpenTasks(owner.client, {
      ...NO_TASK_FILTER,
      projectId: project.id,
    });
    expect(byProject.items.map((item) => item.id)).toEqual([high]);
    const byPriority = await listOpenTasks(owner.client, {
      priority: "low",
      clientId: client.id,
      projectId: "",
    });
    expect(byPriority.items.map((item) => item.id)).toEqual([low]);
    const closed = await listClosedTasks(
      owner.client,
      { ...NO_TASK_FILTER, clientId: client.id },
      0,
    );
    expect(closed.items.map((item) => item.id)).toEqual([done]);

    const options = await listTaskFilterOptions(owner.client);
    expect(options.clients.map((option) => option.id)).toContain(client.id);
    expect(options.projects.find((option) => option.id === project.id)?.client_id).toBe(client.id);
  });

  it("CAL-11: the calendar reads open tasks with a due date in the range, by date and priority", async () => {
    const client = await insertClient();
    const first = await insertAsService({
      client_id: client.id,
      due_date: "1902-03-01",
      priority: "low",
    });
    const second = await insertAsService({
      client_id: client.id,
      due_date: "1902-03-01",
      priority: "high",
    });
    const third = await insertAsService({ client_id: client.id, due_date: "1902-03-07" });
    await insertAsService({ client_id: client.id, due_date: "1902-03-08" });
    await insertAsService({ client_id: client.id, due_date: "1902-03-02", status: "done" });
    await insertAsService({ client_id: client.id, due_date: null });

    const range = await listCalendarTasks(owner.client, "1902-03-01", "1902-03-07");
    expect(range.items.map((item) => item.id)).toEqual([second, first, third]);
    expect(range.hasMore).toBe(false);
  });
});
