# M4.2 – CSV export (EXPORT-1..4)

Source: SPEC.md sections 5.11, 7, 8, 10 (CSV edge cases). Criteria set by the lead under the owner's pre-approval (2026-11-23).

## Acceptance criteria
1. EXPORT-1: export incomes and expenses as separate CSV files for a date range (from/to, inclusive, Asia/Jerusalem dates). Entry point: a "ייצוא" screen under "עוד" (and desktop nav), also linked from the incomes and expenses lists.
2. EXPORT-2: UTF-8 with BOM; amounts in shekels with exactly two decimals (from agorot, no floats); dates DD/MM/YYYY; RFC 4180 quoting (comma, quote, newline in fields); CRLF line endings.
3. EXPORT-3 columns – incomes: תאריך, לקוח, פרויקט, אבן דרך, סכום, אמצעי תשלום, מספר קבלה, תאריך קבלה. Expenses: תאריך, ספק, קטגוריה, סכום, אמצעי תשלום, קיים מסמך (כן/לא). Soft-deleted rows excluded; sorted by date.
4. Security: generated server-side in a Route Handler behind `requireAllowedUser()`; GET with only the date range in the URL (no personal data); `Content-Disposition: attachment` with an ASCII filename (e.g. `hkmanager-incomes-2026-01-01_2026-12-31.csv`); `Cache-Control: no-store`; CSV-injection protection (prefix cells starting with `= + - @` tab/CR with `'`), documented.
5. Validation: from ≤ to; range limited to the existing date bounds; max range 5 years; invalid input shows an inline error, not a broken download. Bounded memory: stream or page through results.
6. EXPORT-4: no receipt file export (out of scope).
7. Carry-overs from M4.1 QA: period-selector input `key` per type (no console warnings) and resync the field after prev/next; `acknowledge_ceiling_alert` refuses a threshold not yet crossed; ack message wording accurate for that threshold.
8. Inherited lessons, a11y, RTL, no horizontal scroll.
9. Tests: unit (CSV formatting: BOM, quoting, names with quotes/commas, newline, injection, 0, large amounts, date format); integration (export query exactness incl. soft-deleted exclusion, RLS); E2E (download both files on android/desktop, parse and compare, validation errors, unauthorized redirect). Names include EXPORT-x.
