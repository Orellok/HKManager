import { INCOMES_PATH } from "@/lib/incomes/paths";

/** Routes of the receipt screens. Only ids and fixed codes go into a URL (SPEC 8). */

/** DOC-1 / DOC-2: issue and record the receipt of an income, or see and edit it. */
export function receiptPath(incomeId: string): string {
  return `${INCOMES_PATH}/${encodeURIComponent(incomeId)}/receipt`;
}

/** Opens the receipt's PDF through a short-lived signed URL (a redirect). */
export function receiptFilePath(incomeId: string): string {
  return `${receiptPath(incomeId)}/file`;
}

/** Codes of the one-time confirmations on the receipt page. */
export type ReceiptNotice = "recorded" | "updated";

export const RECEIPT_NOTICE_MESSAGES: Record<ReceiptNotice, string> = {
  recorded: "הקבלה נשמרה. סטטוס ההכנסה: הופקה קבלה.",
  updated: "פרטי הקבלה עודכנו. השינוי נרשם ביומן השינויים.",
};
