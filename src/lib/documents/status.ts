/**
 * INC-3: an income's document status is derived, never stored: "receipt_issued" when a
 * receipt is recorded for it, otherwise "receipt_pending".
 */
export type ReceiptStatus = "receipt_pending" | "receipt_issued";

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  receipt_pending: "ממתינה לקבלה",
  receipt_issued: "הופקה קבלה",
};

export function receiptStatus(hasReceipt: boolean): ReceiptStatus {
  return hasReceipt ? "receipt_issued" : "receipt_pending";
}
