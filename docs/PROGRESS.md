# Progress log (resume point)

Any session picking up this project: read this file first, then continue from "Next step".
Workflow: `.claude/commands/feature.md` (senior-developer → code-reviewer → qa-engineer, max 3 fix rounds).
Commit and push after every meaningful step.

## Owner decisions (2026-11-15)
- Profile filled from SPEC.md; unit tests: Vitest; package manager: pnpm.
- Build order: M0 split into M0.1 Scaffold → M0.2 Supabase local + base migrations + allowed_users + RLS → M0.3 Auth (AUTH-1..5) → M0.4 CI → M0.5 Sentry. Then M1…M7 per SPEC section 11.
- M0.1: criteria approved as written; shell has a title only (no nav); nonce-based CSP.
- M0.1 copy approved: home h1 "דף הבית", 404 "הדף לא נמצא" / "הכתובת שביקשת אינה קיימת."
- Permissions-Policy: camera stays blocked until M3; open camera=(self) as part of M3 (expense photo capture).
- 2026-11-15: owner created Supabase projects hkmanager-staging and hkmanager-prod (Free plan → 2 free projects confirmed in practice). Refs recorded in docs/setup/environments.md.
- 2026-11-16: owner approved M1.1 Hebrew copy and choices (search on submit via POST, duplicate check on blur + post-save notice, phone rules, max lengths).
- 2026-11-16: owner approved M1.1 round-2 copy ("לא ניתן לשמור כרגע…", "הפעולה לא בוצעה…", "לא הצלחנו לטעון את הדף").
- 2026-11-16: owner approved M1.2 copy and bounds (₪ after number per he-IL, ₪99,999,999.99 max, dates 1900–2100, 500-client hint wording, 50 projects on client card, range/digit messages).
- 2026-11-16: owner wants small PRs to main. Stacked PRs opened: Orellok/HKManager#1 (M0, branch claude/pr-1-m0-foundation @77f541a), #2 (M1.1, claude/pr-2-m1.1-clients @d3d1619), #3 (M1.2, claude/pr-3-m1.2-projects @6181bf8). Owner merged all 3 at once: #1 reached main; #2/#3 landed only in stacked base branches → catch-up PR Orellok/HKManager#4 (claude/pr-2-m1.1-clients → main). #4 merged by owner 2026-11-16 – main now contains M0, M1.1, M1.2. Lesson: no more stacked PRs – each feature PR targets main directly after the previous one merged. Going forward: one PR per feature from a branch at the feature's DONE commit; development continues on claude/adoring-rubin-yrdzla.
- 2026-11-16: owner approved M1.3 deviations/copy (100 milestones/project, no warning with 0 milestones, past-due amount-0 = מתוכנן, 'חזרה') and M2 plan (split M2.1/M2.2, income amount > 0, no future received date, no payments for cancelled milestones, 'הכנסות' as 5th nav item).
- 2026-11-16: owner approved M2.1 deviations and copy (past-due partially paid = לתשלום; payments allowed for archived clients/projects; single-month incomes list; HKI04; balance definitions).
- 2026-11-22: owner approved M2.2 deviations and copy (file OR link; receipt-number format; issue date not future; replaced files kept; pending tab across months; direct signed upload).
- 2026-11-23: owner removed the code-reviewer step: dev → QA → dev fix, max 2 fix rounds (recorded in CLAUDE.md).
- 2026-11-23: owner pre-approved the lead's recommendations – run autonomously, no waiting for approvals (see CLAUDE.md).
- Owner wants work committed continuously and resumed autonomously after interruptions.

## Status
| Feature | Status | Notes |
|---|---|---|
| M0.1 Scaffold | DONE – review APPROVED, QA PASS, 0 fix rounds | docs/specs/m0-1-scaffold.md |
| M0.3 Auth | DONE – review APPROVED, QA PASS, 2 fix rounds (prefetch auth bypass; hook fail-closed + /login redirect) | docs/specs/m0-3-auth.md |
| M0.4 CI + migrations workflow | DONE – review APPROVED, QA PASS, 1 polish round; CI green on GitHub (runs 1-8). Staging/prod workflows verified by mocks only until first merge to main + secrets | docs/specs/m0-4-ci.md |
| M1.1 Clients | DONE – review APPROVED, QA PASS, 3 fix rounds (duplicate notice; action errors/focus/CSP/CRLF; expired session) | docs/specs/m1-1-clients.md |
| M1.2 Projects | DONE – review APPROVED, QA PASS, 2 fix rounds (polish: session 4xx rule, filter queue, date min/max; minor: partial date, range/digit messages) | docs/specs/m1-2-projects.md |
| M1.3 Milestones + open debts | DONE – review APPROVED, QA PASS, 1 polish round (sort_order bound, server-side move result, test robustness) | docs/specs/m1-3-milestones.md | docs/specs/m1-3-milestones.md |
| M2.1 Incomes + payments | DONE – review APPROVED, QA PASS, 3 fix rounds (Enter confirmed overpayment + token/batching/deleted_at; E2E hydration race; notice after hard load/Back, 44px links, archived clients in filter) | docs/specs/m2-1-incomes.md |
| M2.2 Receipts (manual) | DONE – review APPROVED (2 review fix rounds), QA PASS (0 QA rounds) | docs/specs/m2-2-receipts.md | docs/specs/m2-2-receipts.md | docs/specs/m2-1-incomes.md |
| M3 Expenses + uploads | DONE – QA PASS (0 fix rounds) | docs/specs/m3-expenses.md | docs/specs/m3-expenses.md |
| M0.6 Netlify deploy | DONE – QA PASS (local only); real deploy + VERIFY-02 on host pending owner setup | docs/specs/m0-6-deploy.md | docs/specs/m0-6-deploy.md |
| M4.1 Dashboard + ceiling | DONE – QA PASS (0 fix rounds) | docs/specs/m4-1-dashboard.md |
| M4.2 CSV export | implemented (518bbb7..7a93c74) – in QA | docs/specs/m4-2-csv-export.md | docs/specs/m4-1-dashboard.md |
| M0.2 Supabase local + RLS | DONE – review APPROVED, QA PASS, 1 polish round (email length/format, test hardening), re-review APPROVED | docs/specs/m0-2-supabase-local.md |

Resumed by owner 2026-11-22; scheduled task re-enabled by owner request.

## Next step
Owner actions pending: (1) answer whether any migrations were applied manually to staging/prod; (2) create 3 GitHub secrets (docs/setup/github-secrets.md); (3) Google OAuth clients (docs/setup/google-oauth.md); (4) open PR claude/adoring-rubin-yrdzla -> main when ready (first real staging migration run); (5) Netlify account + 2 sites + NETLIFY_AUTH_TOKEN (docs/setup/netlify.md).
VERIFY-02 checked 2026-11-16 (docs/verify/VERIFY-02-netlify.md): commercial use OK, Next 16 supported; OPEN: proxy.ts (Node runtime) on Netlify – gate on first staging deploy; credit budget (hard pause).
Owner approved (2026-11-16): start M1 in parallel; split M1.1 Clients (CLI-1..4), M1.2 Projects (PRJ-1..3), M1.3 Milestones (MS-1..3, MS-6); MS-4/5 move to M2. M0.5 Sentry / M0.6 Netlify wait for owner accounts.
M1.3 PR Orellok/HKManager#5 merged by owner. M2.1 PR: Orellok/HKManager#6. M2.2 PR: Orellok/HKManager#7. M3 PR: Orellok/HKManager#8. M0.6 PR: Orellok/HKManager#9 (merge after #8). PRs #8 (M3), #9 (M0.6), #10 (M4.1) merged by owner. Now: QA of M4.2, then PR.
Lead decision (owner pre-approved): accept M4.2 deviations (Excel type-guessing accepted for V1; injection-guard leading apostrophe; 5-year range rule; both buttons secondary; copy).
Lead decision (owner pre-approved): accept M4.1 deviations (ceiling follows selected period's year; only highest threshold banner, ack covers lower; comparison copy; missing-doc card = this month; top-6 categories + rest; no turnover_basis UI; chart table in collapsible).
Carry into next feature: staging-deploy.yml concurrency → job-level (no-op run can cancel pending deploy). Owner-only: Netlify/GitHub vars per docs/setup/deploy.md; then first staging deploy = VERIFY-02 on host. Lead decision: accept M0.6 deviations (prod deploy also requires prod migrations run; draft→smoke→publish; per-env variable names; token present at build; receipt/photo checks staging-only). Real deploy blocked until owner completes Netlify account/sites/token + GitHub vars.
Carry into next UI feature: expenses row hover contrast (expenses-browser.tsx); focus to camera input after photo error. Lead decision: idempotency key for create forms (duplicate on lost response) → M7 hardening; old file re-recordable on another expense via API → M7 hardening; close 'עוד' on focus-out → next UI feature.
Lead decision (owner pre-approved) 2026-11-23: accept M3 deviations and copy (vendor required ≤120; category name unique ≤50, max 100, never deleted, no audit; single-month list; replace-only file, old kept; 40MB raw limit; root random paths; no-file redirect notice).
Lead process note: commit only docs/PROGRESS.md (never `git commit -a`) while an agent is working. Owner approved M3 plan 2026-11-23.
Next after M3 (owner, 2026-11-23): M0.6 Netlify staging deploy so the owner can try the app. Owner prerequisites: Netlify account + 2 sites + NETLIFY_AUTH_TOKEN; 3 Supabase GitHub secrets; Google OAuth client; Supabase staging auth settings; real allowlist emails in staging.
Carry into next feature: receipt-number message for leading -// ; case-insensitive doc_number uniqueness (owner decision?); payment edit link aria-label label-in-name (milestone-list.tsx:234). Staging smoke step before prod: record one PDF receipt on staging (FOR SHARE on storage.objects runs as postgres via SECURITY DEFINER). Rounds used: 2 of 3. Known flake: AUTH-2 allowlist-removal E2E on android under load. Owner approved M2.2 criteria 2026-11-17. Pending: owner to confirm M2.1 round-3 copy (notice stays until next action; 500/500 filter hint).
Carry into M2.2: MS-6 debts paging E2E is flaky under parallel workers (reads count() before list loads; shared 1900-01-01 seed) – wait for first row and use worker-unique dates. No fix rounds left – any remaining blocking item goes to the owner. Note: no-JS users cannot pick a client on /incomes/new (not required by spec).
Carry into M2: (1) deleting the last milestone loses focus + announcement (live region inside MilestoneList unmounts); (2) shared RedirectNotice: ?notice= reappears after router refresh following an in-page Server Action (also in M1.2) – strip/consume notice robustly.
Lesson: do not run reviewer and QA E2E suites in parallel – they share the local Supabase stack and test users (5 false failures). Carry: debts paging E2E should seed at 1900-01-01 to be order-independent. Owner to confirm M1.3 copy + deviations (100 milestones/project, no warning with 0 milestones, past-due amount-0 = מתוכנן, 'חזרה' dismiss label, view without status column).
Carry into M1.3: isIsoDate uses Date.UTC which maps years 0–99 to 1900s → years 0001–0099 get generic date message instead of range message (use setUTCFullYear). Lead decision: no-JS partial date saved as empty is acceptable (PWA on Chrome always runs JS). Owner to confirm M1.2 Hebrew copy + bounds. Lead concern: criterion 11(a) too narrow – invalid refresh token (AuthApiError 400) should count as 'ended'; only 429/5xx/network = 'unknown'.
Carry into M1.2: checkBrowserSession should return 'ended' only for AuthSessionMissingError or AuthApiError 401/403 (429 currently causes a false redirect); add offline E2E (context.setOffline) asserting no redirect; ref-based in-flight guard in client form (synchronous scripted triple click creates 3 rows). Owner to confirm M1.1 Hebrew copy + choices (search on submit via POST, duplicate check on blur, phone rules, max lengths).
Manual staging check (when Google OAuth + staging exist): allowlisted Google account is created and reaches home – confirms GoTrue sends user_metadata.email_verified (hook fails closed otherwise).
Proposed split: M0.4 CI + Supabase migrations workflows; M0.5 Sentry; M0.6 Netlify staging/prod deploy (needs owner Netlify account + VERIFY-02).
Carry into M0.3: CSP connect-src += Supabase URL; @types/node ^22; focus ring contrast fix; revisit enable_signup for Google OAuth; SQL-level test for missing/empty email claim; optional tests (normal emails accepted, ~3000-char email).
Later (AUTH-5 UI): last-admin protection; trigger-enforced created_by/created_at.
Environment: start Docker with `nohup dockerd >/tmp/dockerd.log 2>&1 &`; use SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io in the cloud sandbox.
