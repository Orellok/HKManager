import {
  MAX_ISO_DATE,
  MIN_ISO_DATE,
  formatIsoDate,
  isIsoDate,
  isIsoDateInRange,
} from "@/lib/dates";
import { emptyToNull } from "@/lib/forms";
import { MAX_AGOROT, formatAgorot, parseShekelsToAgorot, type ShekelParseError } from "@/lib/money";
import { z } from "@/lib/zod";

/**
 * Amount and date fields shared by the form schemas (projects, milestones): the same input
 * rules and the same Hebrew messages everywhere. Amounts are typed in shekels and become
 * integer agorot; dates are ISO strings from the native date input.
 */

export const AMOUNT_MESSAGES: Record<ShekelParseError, string> = {
  invalid: "יש להזין סכום בספרות, למשל 12,500 או 12,500.50.",
  non_latin_digits: "יש להזין את הסכום בספרות 0–9 בלבד.",
  too_many_decimals: "אפשר להזין עד שתי ספרות אחרי הנקודה (אגורות).",
  negative: "הסכום לא יכול להיות שלילי.",
  too_large: `הסכום גדול מדי (עד ${formatAgorot(MAX_AGOROT)}).`,
};

export const DATE_MESSAGES = {
  invalid: "יש להזין תאריך תקין.",
  outOfRange: `יש להזין תאריך בין ${formatIsoDate(MIN_ISO_DATE)} ל-${formatIsoDate(MAX_ISO_DATE)}.`,
} as const;

/** An ISO date in the accepted range; "" is passed through for the caller to handle. */
function dateString() {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || isIsoDate(value), {
      error: DATE_MESSAGES.invalid,
      abort: true,
    })
    .refine((value) => value === "" || isIsoDateInRange(value), {
      error: DATE_MESSAGES.outOfRange,
    });
}

/** An optional date: "" → null. */
export function optionalDateField() {
  return dateString().transform(emptyToNull);
}

/** A required date, with `requiredMessage` when empty. */
export function requiredDateField(requiredMessage: string) {
  return z.string().trim().min(1, { error: requiredMessage, abort: true }).pipe(dateString());
}

function toAgorot(value: string, context: z.RefinementCtx): number {
  const parsed = parseShekelsToAgorot(value);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: AMOUNT_MESSAGES[parsed.error] });
    return z.NEVER;
  }
  return parsed.agorot;
}

/** Shekels as typed → integer agorot, or null when empty. */
export function optionalAmountField() {
  return z
    .string()
    .trim()
    .transform((value, context): number | null => (value === "" ? null : toAgorot(value, context)));
}

/** Shekels as typed → integer agorot, with `requiredMessage` when empty. */
export function requiredAmountField(requiredMessage: string) {
  return z
    .string()
    .trim()
    .min(1, { error: requiredMessage, abort: true })
    .transform((value, context): number => toAgorot(value, context));
}
