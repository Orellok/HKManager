/**
 * Money (SPEC 0.6): amounts are stored as integer agorot (bigint in Postgres) and never go
 * through floating-point arithmetic. Typed shekel amounts are parsed as strings into an
 * integer number of agorot, and agorot are formatted from their digits.
 */

/**
 * The largest amount the app accepts: ₪99,999,999.99. Far above any real contract, and
 * far below Number.MAX_SAFE_INTEGER, so an amount read from the database as a JSON number is
 * always exact. The database repeats it as a check constraint.
 */
export const MAX_AGOROT = 9_999_999_999;

const AGOROT_PER_SHEKEL_DIGITS = 2;

/** Whole shekels with or without thousands separators, then up to any number of decimals. */
const SHEKEL_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
/** A currency sign the user may type or paste before or after the number. */
const SHEKEL_SIGN_PATTERN = /^₪\s*|\s*₪$/g;
const MINUS_PATTERN = /^[-−]/;
/**
 * A decimal digit of another script (Arabic-Indic "١٢٣", full-width "１２３"). Rejected, but
 * with its own message. Built with RegExp: the \p{} escape needs the ES2018 target.
 */
const NON_LATIN_DIGIT_PATTERN = new RegExp("(?![0-9])\\p{Nd}", "u");
/** More digits than this cannot be at most MAX_AGOROT; checked before converting to a number. */
const MAX_AGOROT_DIGITS = String(MAX_AGOROT).length;

export type ShekelParseError =
  "invalid" | "non_latin_digits" | "too_many_decimals" | "negative" | "too_large";

export type ShekelParseResult =
  { ok: true; agorot: number } | { ok: false; error: ShekelParseError };

/**
 * Parses a typed amount in shekels ("12500", "12,500", "12,500.50", "₪12,500") to integer
 * agorot. At most two decimals; no negative amounts; at most MAX_AGOROT. Commas must group
 * thousands ("1,25" is rejected rather than guessed).
 */
export function parseShekelsToAgorot(input: string): ShekelParseResult {
  const text = input.trim().replace(SHEKEL_SIGN_PATTERN, "");
  if (NON_LATIN_DIGIT_PATTERN.test(text)) {
    return { ok: false, error: "non_latin_digits" };
  }
  if (MINUS_PATTERN.test(text)) {
    return { ok: false, error: "negative" };
  }
  const match = SHEKEL_PATTERN.exec(text);
  if (!match) {
    return { ok: false, error: "invalid" };
  }
  const [, wholePart, fraction = ""] = match;
  if (fraction.length > AGOROT_PER_SHEKEL_DIGITS) {
    return { ok: false, error: "too_many_decimals" };
  }
  const digits = (
    wholePart.replaceAll(",", "") + fraction.padEnd(AGOROT_PER_SHEKEL_DIGITS, "0")
  ).replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_AGOROT_DIGITS) {
    return { ok: false, error: "too_large" };
  }
  // An integer string of at most 10 digits: Number() is exact.
  const agorot = Number(digits);
  if (agorot > MAX_AGOROT) {
    return { ok: false, error: "too_large" };
  }
  return { ok: true, agorot };
}

function assertAgorot(agorot: number): void {
  if (!Number.isSafeInteger(agorot)) {
    throw new RangeError("An amount in agorot must be a safe integer");
  }
}

/** The amount as a decimal string of shekels, e.g. 1250050 → "12500.50", from its digits. */
function agorotToDecimal(agorot: number): string {
  assertAgorot(agorot);
  const sign = agorot < 0 ? "-" : "";
  const digits = String(Math.abs(agorot)).padStart(AGOROT_PER_SHEKEL_DIGITS + 1, "0");
  const split = digits.length - AGOROT_PER_SHEKEL_DIGITS;
  return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
}

const SHEKEL_FORMAT = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });

/**
 * Formats agorot for display in Hebrew, e.g. 1250050 → "‏12,500.50 ‏₪" (he-IL puts the sign
 * after the number, with direction marks so it reads correctly in RTL text). The decimal
 * string is passed to Intl as a string, which formats it exactly.
 */
export function formatAgorot(agorot: number): string {
  return SHEKEL_FORMAT.format(agorotToDecimal(agorot) as `${number}`);
}

/** The amount as the edit form shows it: "12500.50", or "12500" for whole shekels. */
export function agorotToShekelInput(agorot: number): string {
  const decimal = agorotToDecimal(agorot);
  return decimal.endsWith(".00") ? decimal.slice(0, -3) : decimal;
}

/**
 * An amount read from the database. PostgREST sends bigint as a JSON number, but a string is
 * accepted too; anything that is not an integer between 0 and MAX_AGOROT is rejected rather
 * than shown wrong.
 */
export function agorotFromDb(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const agorot =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(agorot) || agorot < 0 || agorot > MAX_AGOROT) {
    throw new RangeError("The database returned an amount outside the supported range");
  }
  return agorot;
}

/**
 * A sum of amounts read from the database (e.g. the total of open debts). It can exceed
 * MAX_AGOROT but must be a non-negative safe integer: a larger value would have lost
 * precision in JSON and is rejected rather than shown wrong.
 */
export function agorotTotalFromDb(value: unknown): number {
  const agorot =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(agorot) || agorot < 0) {
    throw new RangeError("The database returned a total outside the supported range");
  }
  return agorot;
}

/**
 * A balance read from the database (amount − paid). Negative when more was paid than the
 * amount (MS-5 allows an overpayment after confirmation). Must be a safe integer: a larger
 * value would have lost precision in JSON and is rejected rather than shown wrong.
 */
export function balanceAgorotFromDb(value: unknown): number {
  const agorot =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(agorot)) {
    throw new RangeError("The database returned a balance outside the supported range");
  }
  return agorot;
}

const WHOLE_SHEKEL_FORMAT = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/**
 * An amount rounded to whole shekels (half away from zero), for chart axis labels where
 * agorot would only add noise, e.g. 1250050 → "‏12,501 ‏₪". Integer arithmetic only; a
 * fractional input (a scale's tick position) is first rounded to whole agorot.
 */
export function formatWholeShekels(agorot: number): string {
  const whole = Math.round(agorot);
  assertAgorot(whole);
  const magnitude = Math.abs(whole);
  const remainder = magnitude % 100;
  const shekels = (magnitude - remainder) / 100 + (remainder >= 50 ? 1 : 0);
  return WHOLE_SHEKEL_FORMAT.format(whole < 0 && shekels > 0 ? -shekels : shekels);
}
