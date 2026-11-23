/**
 * EXPORT-2: CSV text as RFC 4180 describes it, for Excel: UTF-8 with a byte order mark (so
 * Excel reads Hebrew as UTF-8), fields separated by commas, records ending in CRLF, and a
 * field quoted when it holds a comma, a double quote, CR or LF (quotes inside are doubled).
 *
 * CSV injection (formula injection, OWASP): a spreadsheet runs a cell that starts with
 * "=", "+", "-" or "@" as a formula, and a leading tab or CR can hide such a start. Any field
 * that starts with one of these characters gets a leading apostrophe, so it is shown as
 * text. Names typed by users (clients, projects, vendors) are the only fields that can start
 * so; the trade-off is that a vendor named "-5%" is exported as "'-5%".
 */

/** U+FEFF; TextEncoder writes it as the bytes EF BB BF. */
export const CSV_BOM = "﻿";
export const CSV_LINE_END = "\r\n";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** A field that cannot start a formula: a leading apostrophe when it could. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One field, protected against formula injection and quoted when RFC 4180 requires it. */
export function csvField(value: string): string {
  const safe = neutralizeFormula(value);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One record with its CRLF. */
export function csvRecord(fields: readonly string[]): string {
  return fields.map(csvField).join(",") + CSV_LINE_END;
}
