import { formatAgorot } from "@/lib/money";

/**
 * MS-5: a payment above the milestone's balance is not blocked, but needs explicit
 * confirmation. The database compares the amount with the balance it reads under a lock
 * (save_income) and, when it is higher, asks for confirmation with that balance. The user
 * confirms by submitting the form again with a token that names both the balance shown in
 * the warning and the amount it was about: the payment is saved only when the balance is
 * still the same (a payment recorded meanwhile changes it) and the amount was not changed
 * after the warning. Otherwise the user is warned again with the current numbers.
 */

/** The form field that carries the confirmation token (the confirm button's value). */
export const OVERPAYMENT_CONFIRM_FIELD = "confirm_overpayment";

export type OverpaymentConfirmation = {
  /** Agorot left on the milestone when the user was warned (negative when overpaid). */
  balance: number;
  /** The amount in agorot the warning was about. */
  amount: number;
};

/** Whether `amount` is more than the milestone's `balance` (both agorot). */
export function isOverpayment(amount: number, balance: number): boolean {
  return amount > balance;
}

export function overpaymentToken({ balance, amount }: OverpaymentConfirmation): string {
  return `${balance}:${amount}`;
}

const TOKEN_PATTERN = /^(-?\d{1,16}):(\d{1,16})$/;

/** The confirmation in a submitted token, or null for a missing or malformed one. */
export function parseOverpaymentToken(value: unknown): OverpaymentConfirmation | null {
  const match = typeof value === "string" ? TOKEN_PATTERN.exec(value) : null;
  if (!match) {
    return null;
  }
  const balance = Number(match[1]);
  const amount = Number(match[2]);
  return Number.isSafeInteger(balance) && Number.isSafeInteger(amount) ? { balance, amount } : null;
}

/**
 * The balance the user confirmed paying above, for this amount; null when there is no
 * confirmation or it was given for another amount (then the database asks again).
 */
export function confirmedBalanceFor(
  token: OverpaymentConfirmation | null,
  amount: number,
): number | null {
  return token !== null && token.amount === amount ? token.balance : null;
}

/** The warning shown before an overpayment is saved. */
export function overpaymentMessage({ balance, amount }: OverpaymentConfirmation): string {
  if (balance <= 0) {
    return `אבן הדרך כבר שולמה במלואה. רישום התשלום (${formatAgorot(amount)}) ייצור תשלום ביתר. לרשום בכל זאת?`;
  }
  return `הסכום (${formatAgorot(amount)}) גבוה מהיתרה של אבן הדרך (${formatAgorot(balance)}) ב-${formatAgorot(amount - balance)}. לרשום בכל זאת?`;
}
