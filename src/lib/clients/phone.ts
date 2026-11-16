/**
 * Phone search (CLI-3) ignores separators: "0501234567" finds "050-123-4567". The database
 * keeps the digits of every stored phone in clients.phone_digits with the same rule.
 */

/** Characters a phone search query may contain besides digits. */
const PHONE_QUERY_PATTERN = /^[0-9 ()+-]+$/;

/** The digits of a phone number, in order, without separators. */
export function phoneDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

/**
 * The digits to search phones by, or null when the query is not phone-like (it contains
 * letters or other characters, or no digit at all) and should match names only.
 */
export function phoneSearchDigits(query: string): string | null {
  const trimmed = query.trim();
  if (!PHONE_QUERY_PATTERN.test(trimmed)) {
    return null;
  }
  const digits = phoneDigits(trimmed);
  return digits === "" ? null : digits;
}
