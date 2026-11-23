/** Routes of the expenses screens. Only ids and fixed codes go into a URL (SPEC 8). */

export const EXPENSES_PATH = "/expenses";
export const NEW_EXPENSE_PATH = "/expenses/new";

/** EXP-6 / DASH-5: opens the list on the current month's expenses without a document. */
export const MISSING_DOCUMENT_PARAM = "missing";
export const MISSING_DOCUMENT_EXPENSES_PATH = `${EXPENSES_PATH}?${MISSING_DOCUMENT_PARAM}=1`;

export function editExpensePath(id: string): string {
  return `${EXPENSES_PATH}/${encodeURIComponent(id)}/edit`;
}

/** Opens the expense's file through a short-lived signed URL (a redirect). */
export function expenseFilePath(id: string): string {
  return `${EXPENSES_PATH}/${encodeURIComponent(id)}/file`;
}

/**
 * EXP-7 (until VERIFY-07 is closed): shown after saving an expense with a photo or file, and
 * wherever its file is shown. Nothing may suggest the photo replaces the original.
 */
export const KEEP_ORIGINAL_MESSAGE = "יש לשמור את הקבלה המקורית.";

/** Codes of the one-time confirmations on the expenses list. */
export type ExpenseNotice =
  "created" | "created_with_file" | "updated" | "updated_with_file" | "deleted";

export const EXPENSE_NOTICE_MESSAGES: Record<ExpenseNotice, string> = {
  created: 'ההוצאה נשמרה ומסומנת "חסר מסמך". אפשר לצרף את הקבלה בעריכת ההוצאה.',
  created_with_file: `ההוצאה נשמרה. ${KEEP_ORIGINAL_MESSAGE}`,
  updated: "השינויים בהוצאה נשמרו.",
  updated_with_file: `השינויים בהוצאה נשמרו. ${KEEP_ORIGINAL_MESSAGE}`,
  deleted: "ההוצאה נמחקה.",
};

/** EXP-7: these confirmations stay on screen until the user leaves it. */
export function isPersistentExpenseNotice(code: unknown): boolean {
  return code === "created_with_file" || code === "updated_with_file";
}
