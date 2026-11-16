import { ARCHIVED_VIEW, VIEW_PARAM } from "@/lib/list-view";

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
export type ProjectNotice = "created" | "updated" | "deleted";

export const PROJECT_NOTICE_MESSAGES: Record<ProjectNotice, string> = {
  created: "הפרויקט נשמר.",
  updated: "השינויים נשמרו.",
  deleted: "הפרויקט נמחק.",
};
