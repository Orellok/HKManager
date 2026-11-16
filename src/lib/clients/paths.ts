import { ARCHIVED_VIEW, VIEW_PARAM } from "@/lib/list-view";

/** Routes of the clients screens. Only ids (never names or phones) go into a URL (SPEC 8). */

export const CLIENTS_PATH = "/clients";
export const NEW_CLIENT_PATH = "/clients/new";

export function clientPath(id: string): string {
  return `${CLIENTS_PATH}/${encodeURIComponent(id)}`;
}

export function editClientPath(id: string): string {
  return `${clientPath(id)}/edit`;
}

/** `?view=archived` shows the archive (CLI-2). */
export const ARCHIVED_CLIENTS_PATH = `${CLIENTS_PATH}?${VIEW_PARAM}=${ARCHIVED_VIEW}`;

/** Codes of the one-time confirmations on the clients screens; see notices.ts for their texts. */
export type ClientNotice =
  | "created"
  | "created_duplicate"
  | "created_duplicate_archived"
  | "updated"
  | "updated_duplicate"
  | "updated_duplicate_archived"
  | "deleted";
