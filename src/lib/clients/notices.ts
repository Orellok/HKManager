import { noticeMessage } from "@/lib/notices";
import { TASK_NOTICE_MESSAGES } from "@/lib/tasks/notices";

import type { ClientNotice } from "./paths";
import type { DuplicateClient } from "./queries";

/** Texts of the one-time confirmations shown after a redirect (by `?notice=` code). */
export const CLIENT_NOTICE_MESSAGES: Record<ClientNotice, string> = {
  created: "הלקוח נשמר.",
  created_duplicate: "הלקוח נשמר. שימו לב: כבר קיים לקוח נוסף בשם הזה.",
  created_duplicate_archived: "הלקוח נשמר. שימו לב: בארכיון כבר יש לקוח בשם הזה.",
  updated: "השינויים נשמרו.",
  updated_duplicate: "השינויים נשמרו. שימו לב: כבר קיים לקוח נוסף בשם הזה.",
  updated_duplicate_archived: "השינויים נשמרו. שימו לב: בארכיון כבר יש לקוח בשם הזה.",
  deleted: "הלקוח נמחק.",
  // TASK-8: a task saved or deleted from the client card returns here.
  ...TASK_NOTICE_MESSAGES,
};

/** The message for a `?notice=` value, or undefined for a missing or unknown code. */
export function clientNoticeMessage(code: unknown): string | undefined {
  return noticeMessage(CLIENT_NOTICE_MESSAGES, code);
}

/**
 * The notice after a save (duplicate-name owner decision: warn, never block). With other
 * clients of the same name it warns; the archived wording is used only when all of them are
 * archived, as in the form's warning.
 */
export function saveNotice(
  saved: "created" | "updated",
  sameName: readonly Pick<DuplicateClient, "archived_at">[],
): ClientNotice {
  if (sameName.length === 0) {
    return saved;
  }
  return sameName.every((client) => client.archived_at !== null)
    ? `${saved}_duplicate_archived`
    : `${saved}_duplicate`;
}
