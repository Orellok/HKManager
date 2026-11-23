# M6 – Tasks + in-app reminders (TASK-1..10, NOTIF-1..3, CAL-11 in-app part, DASH-5 tasks)

Source: SPEC.md sections 3, 5.8 (CAL-11), 5.9 (DASH-5), 5.12 (TASK-1..10), 5.13 (NOTIF-1..3), 6 (`tasks`), 10. Criteria set by the lead under the owner's pre-approval. Push (NOTIF-4..16) is M7; Google Calendar (M5) is separate – CAL-11 here means tasks shown in an in-app calendar view that works without Google.

## Acceptance criteria
1. Migration `tasks`: title (required), description, due_date (date, nullable), priority (`high`/`normal`/`low`, default normal), status (`open`/`done`/`cancelled`), client_id FK null, project_id FK null, completed_at, deleted_at; RLS; no DELETE (TASK-10 soft delete); DB-enforced: project's client must equal client_id when both set (TASK-9); completed_at set/cleared by the DB on status change.
2. TASK-1/2/5: create/edit/soft-delete; no assignee; due date optional – tasks without one go to "ללא דדליין", get no reminders, don't appear in calendar.
3. TASK-3: `overdue` computed (open and due_date < today in Asia/Jerusalem), never stored.
4. TASK-4: one-tap "בוצע" toggle (and undo) from the list, the dashboard card and the calendar view; stores completed_at.
5. TASK-6: grouped list – באיחור, היום, מחר, בהמשך, ללא דדליין; within group by due date then priority (high first); separate tab "בוצעו/בוטלו".
6. TASK-7: filters by priority, client, project (POST, no personal data in URLs).
7. TASK-8/9: tasks section on client and project cards with quick create (pre-filled link); choosing a project fills the client; a project of another client cannot be chosen.
8. TASK-10: archiving a client/project does not delete its tasks.
9. NOTIF-1: nav badge = overdue + today count (accessible text, e.g. "משימות, 3 לטיפול"). NOTIF-2: dashboard tasks card (באיחור / להיום / למחר) and a banner when there are overdue tasks. NOTIF-3: computed on load from data, no dependency on Push/jobs.
10. CAL-11 (in-app): a "יומן" screen with agenda (default on mobile), day, week and month views (CAL-1 views) showing open tasks with a due date on their date, visually distinct, with "בוצע" toggle; works with no Google connection (Google events come in M5). Week starts Sunday; Asia/Jerusalem.
11. Navigation: "משימות" and "יומן" added (mobile under "עוד" with the badge on "עוד" too; desktop all items).
12. Carry-overs from M4.2: export screen over-long hand-made date must show an error (no silent truncation to a valid value); malformed echoed date must not be used as the input's defaultValue (no console warning).
13. Inherited lessons, a11y (WCAG 2.1 AA), RTL, no horizontal scroll 360/412/1280.
14. Tests: unit (overdue and grouping around midnight and DST in Asia/Jerusalem, sorting, badge count); integration (RLS, no delete, TASK-9 rule, completed_at trigger, archive keeps tasks); E2E (create, assign to project, done/undo from list, dashboard and calendar, groups, filters, badge, card quick create, no-due-date group, calendar views without Google). Names include TASK-x / NOTIF-x / CAL-11.
