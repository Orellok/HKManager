/** A list shows either the active records or the archive: `?view=archived`. */
export const VIEW_PARAM = "view";
export const ARCHIVED_VIEW = "archived";

export type ListView = "active" | "archived";

/** The view named by a `?view=` value; anything but "archived" is the active list. */
export function listViewFrom(param: unknown): ListView {
  return param === ARCHIVED_VIEW ? "archived" : "active";
}
