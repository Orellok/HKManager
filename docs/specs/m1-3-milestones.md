# M1.3 – Milestones (MS-1..3) + open debts (MS-6)

Source: SPEC.md sections 0, 5.3 (PRJ-3), 5.4 (MS-1..3, MS-6), 6 (`milestones`, `milestone_balances` view), 7, 8, 10. Approved by the owner on 2026-11-16. MS-4/MS-5 (record payment) belong to M2.

## Acceptance criteria

1. Migration creates `milestones`: common fields, `project_id` (FK → projects, ON DELETE RESTRICT, so a project with milestones cannot be deleted), `description`, `amount` (bigint agorot, ≥ 0, same upper bound as contract amount), `due_date`, `sort_order`, `cancelled_at`. Indexes on `project_id`, `due_date`. RLS via `is_allowed_user()`; column grants as in previous features. RLS guard test covers it.
2. MS-1: the project card lists milestones in `sort_order`, with add, edit and **owner decision: reorder via "למעלה"/"למטה" buttons** (no drag), keyboard and screen-reader accessible, focus kept on the moved item. Required: description, amount, due date.
3. MS-2: status is **computed, never stored**. In M1.3 (no incomes yet): `planned` (due date ≥ today), `due` (due date < today and balance > 0), `cancelled` (`cancelled_at` set). "Today" = current date in `Asia/Jerusalem`. The computation is written so M2 adds `partially_paid`/`paid` from incomes without changing callers (e.g. a `milestone_balances` view or one shared function with paid = 0 for now). Status shown as text.
4. Cancel / un-cancel a milestone (sets/clears `cancelled_at`), with confirmation for cancel.
5. **Owner decision – delete:** a milestone with no payments can be permanently deleted after confirmation; one with payments can only be cancelled (enforced with the incomes FK in M2). In M1.3 every milestone is deletable.
6. MS-3: when the sum of non-cancelled milestone amounts differs from the project's contract amount, a warning shows the difference (not blocking). No warning when the contract amount is empty – show the milestones total instead.
7. MS-6: "חובות פתוחים" screen: non-cancelled milestones with balance > 0 and due date < today (Asia/Jerusalem), sorted oldest first, showing client, project (links), description, due date, days overdue, balance, plus a total. **Owner decision:** project status and archive state do not filter the list (spec-literal; nothing disappears silently). Bounded paging.
8. **Owner decision – navigation:** add "חובות" to the nav (בית, לקוחות, פרויקטים, חובות).
9. Lessons from M1.1/M1.2 apply from the start (inline errors with input kept, expired-session redirect, focus, nonce CSP, no personal data in URLs/logs, in-flight guard, money without floats, dates without timezone shifts, every page/action calls `requireAllowedUser()`).
10. Carry-over from M1.2: `isIsoDate` must handle years 0001–0099 correctly so out-of-range dates get the range message.
11. States, accessibility (WCAG 2.1 AA), RTL, no horizontal scroll at 360/412/1280.
12. Tests: unit (status computation incl. today/yesterday boundary in Asia/Jerusalem around midnight and DST change; sum-vs-contract warning; days overdue; reorder logic); integration (RLS; FK restrict on project delete; constraints; debts query ordering and filters); E2E on android and desktop for add/edit/reorder/cancel/un-cancel/delete, warning, open debts screen and nav, network failure, offline. Test names include MS-1..3, MS-6.
13. Out of scope: recording payments, paid/partially paid, incomes (M2).
