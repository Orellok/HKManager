# M3 – Expenses and file uploads (EXP-1..7)

Source: SPEC.md sections 0, 3, 4, 5.7 (EXP-1..7), 5.14 (SET – expense categories), 6 (`expenses`, `expense_categories`, `audit_log`), 7, 8, 10. Approved by the owner on 2026-11-23.

## Acceptance criteria

1. Migrations: `expense_categories` (name, sort_order, archived_at; seed the 12 categories from EXP-3 in that order) and `expenses` (expense_date, amount bigint agorot, vendor, category_id FK RESTRICT, payment_method – same list as incomes, notes, file_path null, deleted_at). RLS via `is_allowed_user()`, column grants, no DELETE for users; audit trigger on expenses (changed fields only, notes as `{"changed":true}`, like incomes).
2. **Owner decisions:** amount > 0; expense_date not in the future (Asia/Jerusalem); soft delete + audit (no physical delete of financial records).
3. EXP-2: attach a receipt photo/file from the phone. **Owner decision:** JPEG, PNG or PDF; images compressed client-side (canvas, longest side ≤ 2000px, JPEG) before upload; ≤ 10MB after compression; private bucket, server-verified upload (size, MIME, magic bytes) following the M2.2 signed-upload pattern; viewing via short-lived signed URL; no personal data in paths. Camera: `<input capture>` and Permissions-Policy `camera=(self)` (owner decision from M0.1).
4. EXP-3 / **owner decision:** categories managed by both allowlisted users (owner and admin) on a first "הגדרות" screen (rename, reorder, add, archive/restore). A category with expenses is archived, never deleted; archived categories are hidden when choosing for a new expense but still shown on existing ones.
5. EXP-4: expenses list with filters by month, category and vendor, and a total for the current filter; bounded paging; search via POST (no personal data in URLs).
6. EXP-5: expenses are business-level only – no project link.
7. EXP-6: an expense without a file is allowed and marked "חסר מסמך"; filterable.
8. EXP-7: after saving an expense with a photo/file, a persistent message "יש לשמור את הקבלה המקורית" – no wording implying the photo replaces the original.
9. **Owner decision – navigation:** mobile bottom bar: בית, לקוחות, פרויקטים, הכנסות, עוד. "עוד" holds חובות, הוצאות, הגדרות (later יומן, משימות). Desktop side nav shows all items. Accessible (menu button / disclosure with keyboard and screen-reader support, `aria-current` on the active item, also reflected on "עוד" when a child is active).
10. Carry-overs from M2.2: receipt-number message explains a leading `-`/`/`; payment "עריכה" link accessible name starts with the visible text (WCAG 2.5.3, `milestone-list.tsx`). (Case-insensitive receipt number uniqueness: not changed – owner did not ask.)
11. Lessons from previous features apply (inline errors with input kept, expired-session redirect, focus, nonce CSP, ref-based in-flight guard, hydration-safe controls, notices consumed once, money without floats, dates without timezone shift, `requireAllowedUser()` everywhere).
12. States, accessibility (WCAG 2.1 AA), RTL, no horizontal scroll at 360/412/1280.
13. Tests: unit (schema, compression sizing logic, filters/totals); integration (RLS, no delete, soft delete, audit, category archive rules, storage policies); E2E on android and desktop (create with photo/PDF/no file, compression path, EXP-7 message, filters and totals, missing-document mark, categories management, "עוד" nav, network failure/offline). Test names include EXP-1..7.
14. Out of scope: OCR, recurring expenses, bank import, project allocation, CSV export (M4), dashboard (M4).
