import { projectPath } from "@/lib/projects/paths";

/** Routes of the incomes screens. Only ids and fixed codes go into a URL (SPEC 8). */

export const INCOMES_PATH = "/incomes";
export const NEW_INCOME_PATH = "/incomes/new";

/** `?milestone=<id>` records a payment for a milestone (MS-4); `?project=<id>` for a project. */
export const MILESTONE_PARAM = "milestone";
export const PROJECT_PARAM = "project";
/** `?from=project` returns to the project card after saving; otherwise to the incomes list. */
export const FROM_PARAM = "from";

export const RETURN_TARGETS = ["incomes", "project"] as const;

export type ReturnTarget = (typeof RETURN_TARGETS)[number];

/** The return target named by a `?from=` value; anything but "project" is the list. */
export function returnTargetFrom(param: unknown): ReturnTarget {
  return param === "project" ? "project" : "incomes";
}

function withParams(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, value);
    }
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** MS-4: "רשום תשלום" for a milestone, back to its project card afterwards. */
export function recordPaymentPath(milestoneId: string): string {
  return withParams(NEW_INCOME_PATH, { [MILESTONE_PARAM]: milestoneId, [FROM_PARAM]: "project" });
}

/** A new income for a project (without a milestone), back to its project card afterwards. */
export function newProjectIncomePath(projectId: string): string {
  return withParams(NEW_INCOME_PATH, { [PROJECT_PARAM]: projectId, [FROM_PARAM]: "project" });
}

export function editIncomePath(id: string, from: ReturnTarget = "incomes"): string {
  return withParams(`${INCOMES_PATH}/${encodeURIComponent(id)}/edit`, {
    [FROM_PARAM]: from === "project" ? "project" : undefined,
  });
}

/** Where a saved or deleted income returns to. */
export function returnPath(from: ReturnTarget, projectId: string | null): string {
  return from === "project" && projectId !== null ? projectPath(projectId) : INCOMES_PATH;
}

/** Codes of the one-time confirmations on the incomes list. */
export type IncomeNotice = "created" | "updated" | "deleted";

export const INCOME_NOTICE_MESSAGES: Record<IncomeNotice, string> = {
  created: "ההכנסה נשמרה.",
  updated: "השינויים בהכנסה נשמרו.",
  deleted: "ההכנסה נמחקה.",
};
