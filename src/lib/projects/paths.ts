import { ARCHIVED_VIEW, VIEW_PARAM } from "@/lib/list-view";
import { TASK_NOTICE_MESSAGES, type TaskNotice } from "@/lib/tasks/notices";

/** Routes of the projects screens. Only ids (never names) go into a URL (SPEC 8). */

export const PROJECTS_PATH = "/projects";
export const NEW_PROJECT_PATH = "/projects/new";
export const ARCHIVED_PROJECTS_PATH = `${PROJECTS_PATH}?${VIEW_PARAM}=${ARCHIVED_VIEW}`;

/** `/projects/new?client=<id>` opens the form with the client chosen (CLI-4). */
export const CLIENT_PARAM = "client";

export function newProjectPath(clientId?: string): string {
  return clientId
    ? `${NEW_PROJECT_PATH}?${CLIENT_PARAM}=${encodeURIComponent(clientId)}`
    : NEW_PROJECT_PATH;
}

export function projectPath(id: string): string {
  return `${PROJECTS_PATH}/${encodeURIComponent(id)}`;
}

export function editProjectPath(id: string): string {
  return `${projectPath(id)}/edit`;
}

/** Codes of the one-time confirmations on the projects screens. */
export type ProjectNotice =
  | "created"
  | "updated"
  | "deleted"
  | "milestone_created"
  | "milestone_updated"
  | "income_created"
  | "income_updated"
  | "income_deleted"
  | TaskNotice;

export const PROJECT_NOTICE_MESSAGES: Record<ProjectNotice, string> = {
  created: "הפרויקט נשמר.",
  updated: "השינויים נשמרו.",
  deleted: "הפרויקט נמחק.",
  milestone_created: "אבן הדרך נשמרה.",
  milestone_updated: "השינויים באבן הדרך נשמרו.",
  income_created: "התשלום נרשם.",
  income_updated: "השינויים בתשלום נשמרו.",
  income_deleted: "התשלום נמחק.",
  // TASK-8: a task saved or deleted from the project card returns here.
  ...TASK_NOTICE_MESSAGES,
};
