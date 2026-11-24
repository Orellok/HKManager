"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { readCreateKey } from "@/lib/create-key";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import type { ListPage } from "@/lib/paged-list";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import type { TaskNotice } from "./notices";
import { taskReturnPath, taskReturnTargetFrom } from "./paths";
import {
  getProjectClientId,
  insertTask,
  listClosedTasks,
  listOpenTasks,
  setTaskDone,
  softDeleteTask,
  updateTask,
  type SaveTaskResult,
  type TaskListItem,
  type TaskRefusal,
} from "./queries";
import {
  TASK_FIELD_MESSAGES,
  readTaskFormValues,
  taskIdSchema,
  validateTaskInput,
  type TaskField,
  type TaskFormValues,
  type TaskInput,
} from "./schema";
import { TASK_PRIORITIES } from "./status";

/**
 * Server Actions for tasks (TASK-1..10). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server, including
 * ids and return targets bound in the browser, which a caller can change.
 *
 * Every change revalidates the whole app: the navigation badge (NOTIF-1, in the root
 * layout), the dashboard card (NOTIF-2), the lists, the calendar and the client and project
 * cards all read tasks.
 */

export type TaskFormState = ServerFormState<TaskField>;

const MESSAGES = {
  saveFailed: "השמירה נכשלה. המשימה לא נשמרה, אפשר לנסות שוב.",
  notFound: "המשימה לא נמצאה. ייתכן שנמחקה.",
  referenceMissing: "הלקוח או הפרויקט שנבחרו לא נמצאו. ייתכן שנמחקו. יש לבחור שוב.",
  deleteFailed: "המחיקה נכשלה. אפשר לנסות שוב.",
  toggleFailed: "הפעולה לא בוצעה. אפשר לנסות שוב.",
  cancelled: "המשימה בוטלה, ולכן אי אפשר לסמן אותה מכאן. אפשר לשנות את הסטטוס בעריכת המשימה.",
} as const;

function revalidateTaskScreens() {
  revalidatePath("/", "layout");
}

function refusedState(values: TaskFormValues, refusal: TaskRefusal): TaskFormState {
  if (refusal === "project_of_other_client") {
    return {
      values,
      fieldErrors: { project_id: TASK_FIELD_MESSAGES.projectOfOtherClient },
      formError: null,
    };
  }
  return { values, fieldErrors: {}, formError: MESSAGES.referenceMissing };
}

/**
 * TASK-9: a project chosen without its client (a form sent without JavaScript) gets its
 * client from the database. A mismatch is left to the database, which refuses it (HKT01).
 */
async function withProjectClient(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  input: TaskInput,
): Promise<TaskInput | null> {
  if (input.project_id === null || input.client_id !== null) {
    return input;
  }
  const clientId = await getProjectClientId(supabase, input.project_id);
  return clientId === null ? null : { ...input, client_id: clientId };
}

async function saveTaskForm(
  taskId: string | null,
  fromParam: unknown,
  formData: FormData,
): Promise<TaskFormState> {
  const values = readTaskFormValues(formData);
  const validation = validateTaskInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }
  let result: SaveTaskResult;
  let input: TaskInput | null;
  try {
    const supabase = await createSupabaseServerClient();
    input = await withProjectClient(supabase, validation.data);
    if (input === null) {
      return { values, fieldErrors: {}, formError: MESSAGES.referenceMissing };
    }
    result =
      taskId === null
        ? await insertTask(supabase, input, readCreateKey(formData))
        : await updateTask(supabase, taskId, input);
  } catch (error) {
    logDbFailure("tasks", taskId === null ? "create" : "update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result.status === "not_found") {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  if (result.status === "refused") {
    return refusedState(values, result.refusal);
  }
  revalidateTaskScreens();
  const notice: TaskNotice = taskId === null ? "task_created" : "task_updated";
  const target = taskReturnPath(taskReturnTargetFrom(fromParam), {
    clientId: input.client_id,
    projectId: input.project_id,
  });
  redirect(withNotice(target, notice));
}

/** TASK-1 / TASK-8: creates a task and returns to the list or to the card it came from. */
export async function createTaskAction(
  from: string,
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  await requireAllowedUser();
  return saveTaskForm(null, from, formData);
}

/** TASK-1: saves changes to a task. */
export async function updateTaskAction(
  taskId: string,
  from: string,
  _previous: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  await requireAllowedUser();
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) {
    return { values: readTaskFormValues(formData), fieldErrors: {}, formError: MESSAGES.notFound };
  }
  return saveTaskForm(id.data, from, formData);
}

/**
 * TASK-10: soft-deletes a task (after the confirmation dialog) and returns to where the edit
 * came from. Returns only on failure.
 */
export async function deleteTaskAction(taskId: string, from: string): Promise<ActionStatus> {
  await requireAllowedUser();
  const id = taskIdSchema.safeParse(taskId);
  if (!id.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof softDeleteTask>>;
  try {
    result = await softDeleteTask(await createSupabaseServerClient(), id.data);
  } catch (error) {
    logDbFailure("tasks", "delete", error);
    return { message: null, error: MESSAGES.deleteFailed };
  }
  if (result.status === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateTaskScreens();
  const target = taskReturnPath(taskReturnTargetFrom(from), {
    clientId: result.clientId,
    projectId: result.projectId,
  });
  redirect(withNotice(target, "task_deleted" satisfies TaskNotice));
}

export type SetTaskDoneActionResult = { ok: true; done: boolean } | { ok: false; error: string };

const setDoneInputSchema = z.object({ taskId: taskIdSchema, done: z.boolean() });

/**
 * TASK-4: marks a task done, or open again ("ביטול סימון"), from the list, the dashboard,
 * the calendar or a card. The caller names the state it wants, so repeating the request (a
 * double tap, a retry, another tab) is harmless: "unchanged" answers with that state.
 */
export async function setTaskDoneAction(input: {
  taskId: string;
  done: boolean;
}): Promise<SetTaskDoneActionResult> {
  await requireAllowedUser();
  const parsed = setDoneInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof setTaskDone>>;
  try {
    result = await setTaskDone(
      await createSupabaseServerClient(),
      parsed.data.taskId,
      parsed.data.done,
    );
  } catch (error) {
    logDbFailure("tasks", "set done", error);
    return { ok: false, error: MESSAGES.toggleFailed };
  }
  if (result === "not_found") {
    return { ok: false, error: MESSAGES.notFound };
  }
  if (result === "cancelled") {
    return { ok: false, error: MESSAGES.cancelled };
  }
  if (result === "changed") {
    revalidateTaskScreens();
  }
  return { ok: true, done: parsed.data.done };
}

export type SearchTasksResult = { ok: true; page: ListPage<TaskListItem> } | { ok: false };

const optionalUuid = z.union([z.literal(""), z.uuid()]);

const searchInputSchema = z.object({
  view: z.enum(["open", "closed"]),
  priority: z.union([z.literal(""), z.enum(TASK_PRIORITIES)]),
  clientId: optionalUuid,
  projectId: optionalUuid,
  offset: z.number().int().min(0),
});

/**
 * TASK-6 / TASK-7: the open tasks (all at once, the screen groups them) or a page of the
 * closed ones for the filters, through a Server Action (POST), so no client or project id
 * chosen in a filter appears in a URL.
 */
export async function searchTasksAction(input: {
  view: "open" | "closed";
  priority: string;
  clientId: string;
  projectId: string;
  offset: number;
}): Promise<SearchTasksResult> {
  await requireAllowedUser();
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  const { view, offset, ...filter } = parsed.data;
  try {
    const supabase = await createSupabaseServerClient();
    return {
      ok: true,
      page:
        view === "open"
          ? await listOpenTasks(supabase, filter)
          : await listClosedTasks(supabase, filter, offset),
    };
  } catch (error) {
    logDbFailure("tasks", "search", error);
    return { ok: false };
  }
}
