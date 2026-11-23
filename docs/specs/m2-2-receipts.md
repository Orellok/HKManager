# M2.2 – Receipts documentation, manual mode (DOC-1..6, INC-3, INC-4)

Source: SPEC.md sections 0, 3, 4, 5.5 (INC-3, INC-4, INC-6), 5.6 (DOC-1..6; DOC-7..9 design only), 6 (`documents`, `app_settings`, `audit_log`), 7, 8, 9.1, 10. Approved by the owner on 2026-11-17.

## Acceptance criteria

1. Migration creates `documents`: common fields, `income_id` (FK RESTRICT, **unique**), `doc_type` (`receipt` only – DOC-6), `provider`, `external_id` (null), `doc_number`, `issued_date`, `file_path` (null), `url` (null); `unique(provider, doc_type, doc_number)` (DOC-3); at least one of `file_path` / `url` required. RLS via `is_allowed_user()`; column grants; **no DELETE** for users. Audit rows for insert/update via the existing audit trigger pattern (changed fields only).
2. Architecture (SPEC 5.6/9.1): a `DocumentProvider` interface with a `ManualProvider` implementation used by the UI; nothing in UI/model depends on the concrete provider. `ApiProvider` is not implemented (DOC-7..9 design only).
3. `app_settings` (key, value jsonb) with seed values: provider name "SUMIT", provider link `https://app.sumit.co.il/`, monthly quota 10. **Owner decision:** no editing UI in M2.2 (comes with the admin settings screen); read-only use. RLS: read for allowlisted users; write admin only.
4. INC-3: income document status is derived – `receipt_pending` (no document) / `receipt_issued` (document exists); shown on the incomes list, project card and income edit page.
5. DOC-1: on a `receipt_pending` income, "הפק קבלה" shows the transaction details (client name, amount, description – milestone/project or notes, received date, payment method) with copy buttons, and a link that opens the provider (from settings, new tab, `rel="noopener noreferrer"`).
6. DOC-2: a form to record the receipt: receipt number, issue date, and **either** a PDF upload **or** an https link. **Owner decision:** PDF only (MIME and magic bytes checked server-side), max 10MB; link must be `https://`. Files go to a private Supabase Storage bucket (path by income id, random file name, no personal data in the path); viewing via a short-lived signed URL. Storage RLS limited to allowlisted users. Status becomes `receipt_issued`.
7. DOC-3: duplicate receipt number (per provider + type) shows a field error.
8. INC-4: once a receipt exists, the income's own fields cannot be edited or soft-deleted (DB-enforced, with a clear message). **Owner decision:** receipt details (number, issue date, file/link) remain editable, every change recorded in `audit_log`; a recorded receipt cannot be deleted.
9. DOC-4: counter "קבלות שהופקו החודש" (by `issued_date`, month in Asia/Jerusalem) vs. the quota setting; warning at ≥ 80% and at/over the quota (not blocking).
10. DOC-5 + **owner decision:** a "קבלות ממתינות" card on the home page (count + link to a pending-receipts list, plus the monthly counter), visible from the day the payment was received. The incomes list gets a "ממתינות לקבלה" filter.
11. Lessons from previous features apply (inline errors with input kept, expired-session redirect, focus, nonce CSP, no personal data in URLs/logs/storage paths, ref-based in-flight guard, hydration-safe controls, notices consumed once, `requireAllowedUser()` everywhere). CSP must allow what the signed-URL viewing needs and nothing more.
12. Carry-over: the MS-6 debts paging E2E must be stable under parallel workers (wait for the list before counting; worker-unique seed dates).
13. States, accessibility (WCAG 2.1 AA), RTL, no horizontal scroll at 360/412/1280.
14. Tests: unit (status derivation, quota thresholds, file validation, provider interface); integration (RLS incl. storage objects; unique receipt number; INC-4 locks; no delete; audit rows; settings read/write rules); E2E on android and desktop (issue flow with copy buttons and provider link, record with PDF and with link, duplicate number, locked income, edit receipt details, quota warnings, home card, pending filter, network failure/offline). Test names include DOC-1..6, INC-3, INC-4.
15. Out of scope: API provider (stage 2), receipts ZIP export (EXPORT-4), dashboard (M4), settings editing UI.
