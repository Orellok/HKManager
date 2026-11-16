/**
 * INC-5: the payment methods, stored as these codes. The database repeats the list as a
 * check constraint (incomes_payment_method_check).
 */
export const PAYMENT_METHODS = [
  "bank_transfer",
  "bit_paybox",
  "cash",
  "check",
  "credit_card",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "העברה בנקאית",
  bit_paybox: "ביט/פייבוקס",
  cash: "מזומן",
  check: "צ'ק",
  credit_card: "אשראי",
  other: "אחר",
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}
