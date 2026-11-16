# M1.1 – Clients (CLI-1..4) + app navigation

Source: SPEC.md sections 0, 5.2 (CLI-1..4), 6 (`clients`), 7, 8, 10. Approved by the owner on 2026-11-16.
M1 split (owner-approved): M1.1 Clients; M1.2 Projects (PRJ-1..3); M1.3 Milestones (MS-1..3, MS-6). MS-4/MS-5 move to M2.

## Acceptance criteria

1. Migration creates `clients`: common fields (`id`, `created_at`, `updated_at`, `created_by`), `name`, `phone`, `email`, `address`, `notes`, `archived_at`. RLS: only allowlisted users (`is_allowed_user()`) can select/insert/update/delete; `anon` nothing. Indexes per SPEC 6. The existing RLS guard test covers it.
2. One zod schema shared by client and server (zod is listed in SPEC 7). **Owner decision:** only `name` is required; phone, email, address, notes optional. Phone allows digits, spaces, `-`, `+`; email validated when present; max lengths on all text fields; values trimmed.
3. CLI-1: client list, create and edit forms (visible labels, Hebrew field errors next to the field, input preserved on error), client card. Every write goes through a Server Action that itself calls `requireAllowedUser()` and validates with the shared schema.
4. CLI-3: search by name or phone. Phone search ignores separators (`0501234567` matches `050-123-4567`). Search is server-side and parameterized.
5. CLI-2: archive (sets `archived_at`) and restore. Archived clients are hidden from the default list and shown with an "ארכיון" filter. **Owner decision:** a client with no projects/incomes can be permanently deleted after a confirmation dialog; a client that has them can only be archived (DB-level enforcement arrives with the `projects` FK in M1.2 and `incomes` in M2).
6. CLI-4: the client card shows the client details in M1.1. Projects are added in M1.2; total paid and balance in M2.
7. **Owner decision:** creating a client whose name matches an existing client (case-insensitive, trimmed) shows a warning but does not block.
8. Navigation: bottom navigation on mobile, side navigation on desktop. Only existing screens appear (now: "בית", "לקוחות"); each later feature adds its own item. Current item indicated (not by color alone).
9. States: empty list with a call to add a client, loading, error, empty search results. Accessibility WCAG 2.1 AA, keyboard use, focus management on dialogs. RTL; no horizontal scroll at 360, 412, 1280 px. List pagination or a sensible limit (no unbounded query).
10. Tests: unit (schema, phone normalization for search, duplicate-name detection); integration (RLS on `clients` for anon / non-allowlisted / owner / admin); E2E on mobile and desktop viewports: create, edit, search by name and by phone, duplicate-name warning, archive, restore, delete with confirmation. Test names include requirement IDs (CLI-1..4).
11. Out of scope: projects, incomes, tasks on the client card (M1.2, M2, M6).
