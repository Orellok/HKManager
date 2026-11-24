"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionStatus } from "@/lib/action-status";
import { requireAllowedUser } from "@/lib/auth/guards";
import { readCreateKey } from "@/lib/create-key";
import { CLIENTS_PATH } from "@/lib/clients/paths";
import type { ServerFormState } from "@/lib/forms";
import { logDbFailure } from "@/lib/log";
import { withNotice } from "@/lib/notices";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "@/lib/zod";

import { PROJECTS_PATH, projectPath, type ProjectNotice } from "./paths";
import {
  deleteProject,
  insertProject,
  listProjects,
  updateProject,
  type ClientRefusal,
  type ProjectListPage,
} from "./queries";
import {
  PROJECT_FIELD_MESSAGES,
  PROJECT_SEARCH_QUERY_MAX_LENGTH,
  projectIdSchema,
  readProjectFormValues,
  validateProjectInput,
  type ProjectField,
  type ProjectFormValues,
} from "./schema";
import { PROJECT_STATUS_FILTERS, type ProjectStatusFilter } from "./status";

/**
 * Server Actions for projects (PRJ-1..3). Each one checks the session with
 * requireAllowedUser() before anything else and validates its input on the server, including
 * ids bound in the browser, which a caller can change.
 */

export type ProjectFormState = ServerFormState<ProjectField>;

export type SearchProjectsResult = { ok: true; page: ProjectListPage } | { ok: false };

const MESSAGES = {
  saveFailed: "השמירה נכשלה. הפרטים לא נשמרו, אפשר לנסות שוב.",
  notFound: "הפרויקט לא נמצא. ייתכן שנמחק.",
  clientMissing: "הלקוח לא נמצא. ייתכן שנמחק. יש לבחור לקוח אחר.",
  clientHasIncomes: "לפרויקט נרשמו הכנסות של הלקוח הנוכחי, ולכן אי אפשר להעביר אותו ללקוח אחר.",
  archived: "הפרויקט הועבר לארכיון.",
  restored: "הפרויקט הוחזר מהארכיון.",
  statusFailed: "הפעולה נכשלה. אפשר לנסות שוב.",
  deleteFailed: "המחיקה נכשלה. אפשר לנסות שוב.",
  deleteReferenced:
    "אי אפשר למחוק פרויקט שיש לו אבני דרך, הכנסות או משימות. אפשר להעביר אותו לארכיון.",
} as const;

function refusedState(values: ProjectFormValues, refusal: ClientRefusal): ProjectFormState {
  return {
    values,
    fieldErrors: {
      client_id: {
        client_archived: PROJECT_FIELD_MESSAGES.clientArchived,
        client_missing: MESSAGES.clientMissing,
        client_has_incomes: MESSAGES.clientHasIncomes,
      }[refusal],
    },
    formError: null,
  };
}

/** Projects appear on the projects screens and on their client's card (CLI-4). */
function revalidateProjectScreens() {
  revalidatePath(PROJECTS_PATH, "layout");
  revalidatePath(CLIENTS_PATH, "layout");
}

/** PRJ-1: creates a project and opens its card. Refused for an archived client. */
export async function createProjectAction(
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  await requireAllowedUser();
  const values = readProjectFormValues(formData);
  const validation = validateProjectInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  let result: Awaited<ReturnType<typeof insertProject>>;
  try {
    result = await insertProject(
      await createSupabaseServerClient(),
      validation.data,
      readCreateKey(formData),
    );
  } catch (error) {
    logDbFailure("projects", "create", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result.status !== "created") {
    return refusedState(values, result.status);
  }
  revalidateProjectScreens();
  redirect(withNotice(projectPath(result.id), "created" satisfies ProjectNotice));
}

/** PRJ-1: saves changes to a project and returns to its card. */
export async function updateProjectAction(
  id: string,
  _previous: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  await requireAllowedUser();
  const values = readProjectFormValues(formData);
  const projectId = projectIdSchema.safeParse(id);
  if (!projectId.success) {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  const validation = validateProjectInput(values);
  if (!validation.success) {
    return { values, fieldErrors: validation.fieldErrors, formError: null };
  }

  let result: Awaited<ReturnType<typeof updateProject>>;
  try {
    result = await updateProject(
      await createSupabaseServerClient(),
      projectId.data,
      validation.data,
    );
  } catch (error) {
    logDbFailure("projects", "update", error);
    return { values, fieldErrors: {}, formError: MESSAGES.saveFailed };
  }
  if (result === "not_found") {
    return { values, fieldErrors: {}, formError: MESSAGES.notFound };
  }
  if (result !== "updated") {
    return refusedState(values, result);
  }
  revalidateProjectScreens();
  redirect(withNotice(projectPath(projectId.data), "updated" satisfies ProjectNotice));
}

async function setArchived(
  id: string,
  archived: boolean,
  successMessage: string,
): Promise<ActionStatus> {
  await requireAllowedUser();
  const projectId = projectIdSchema.safeParse(id);
  if (!projectId.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof updateProject>>;
  try {
    result = await updateProject(await createSupabaseServerClient(), projectId.data, {
      archived_at: archived ? new Date().toISOString() : null,
    });
  } catch (error) {
    logDbFailure("projects", archived ? "archive" : "restore", error);
    return { message: null, error: MESSAGES.statusFailed };
  }
  if (result !== "updated") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateProjectScreens();
  return { message: successMessage, error: null };
}

/** Owner decision (M1.2): moves a project to the archive. */
export async function archiveProjectAction(id: string): Promise<ActionStatus> {
  return setArchived(id, true, MESSAGES.archived);
}

/** Owner decision (M1.2): brings a project back from the archive. */
export async function restoreProjectAction(id: string): Promise<ActionStatus> {
  return setArchived(id, false, MESSAGES.restored);
}

/**
 * Owner decision (M1.2): permanently deletes a project without milestones or incomes, after
 * the confirmation dialog. The database refuses to delete a referenced project.
 */
export async function deleteProjectAction(id: string): Promise<ActionStatus> {
  await requireAllowedUser();
  const projectId = projectIdSchema.safeParse(id);
  if (!projectId.success) {
    return { message: null, error: MESSAGES.notFound };
  }
  let result: Awaited<ReturnType<typeof deleteProject>>;
  try {
    result = await deleteProject(await createSupabaseServerClient(), projectId.data);
  } catch (error) {
    logDbFailure("projects", "delete", error);
    return { message: null, error: MESSAGES.deleteFailed };
  }
  if (result === "referenced") {
    return { message: null, error: MESSAGES.deleteReferenced };
  }
  if (result === "not_found") {
    return { message: null, error: MESSAGES.notFound };
  }
  revalidateProjectScreens();
  redirect(withNotice(PROJECTS_PATH, "deleted" satisfies ProjectNotice));
}

const searchInputSchema = z.object({
  view: z.enum(["active", "archived"]),
  status: z.enum(PROJECT_STATUS_FILTERS),
  query: z.string().max(PROJECT_SEARCH_QUERY_MAX_LENGTH),
  offset: z.number().int().min(0),
});

/**
 * PRJ-1: searches by project or client name, with the status filter. A Server Action (POST)
 * rather than a URL query string, because a client name must not appear in a URL (SPEC 8).
 */
export async function searchProjectsAction(input: {
  view: "active" | "archived";
  status: ProjectStatusFilter;
  query: string;
  offset: number;
}): Promise<SearchProjectsResult> {
  await requireAllowedUser();
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false };
  }
  try {
    return { ok: true, page: await listProjects(await createSupabaseServerClient(), parsed.data) };
  } catch (error) {
    logDbFailure("projects", "search", error);
    return { ok: false };
  }
}
