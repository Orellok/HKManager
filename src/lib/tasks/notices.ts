/**
 * Task notices live apart from paths.ts, which imports the client and project paths: those
 * modules include these texts in their own notices, and a cycle would leave them undefined.
 */

/** Codes of the one-time confirmations on the tasks list (and the cards, see their notices). */
export type TaskNotice = "task_created" | "task_updated" | "task_deleted";

export const TASK_NOTICE_MESSAGES: Record<TaskNotice, string> = {
  task_created: "המשימה נשמרה.",
  task_updated: "השינויים במשימה נשמרו.",
  task_deleted: "המשימה נמחקה.",
};
