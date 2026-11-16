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
- Owner wants work committed continuously and resumed autonomously after interruptions.

## Status
| Feature | Status | Notes |
|---|---|---|
| M0.1 Scaffold | DONE – review APPROVED, QA PASS, 0 fix rounds | docs/specs/m0-1-scaffold.md |
| M0.3 Auth | DONE – review APPROVED, QA PASS, 2 fix rounds (prefetch auth bypass; hook fail-closed + /login redirect) | docs/specs/m0-3-auth.md |
| M0.4 CI + migrations workflow | DONE – review APPROVED, QA PASS, 1 polish round; CI green on GitHub (runs 1-8). Staging/prod workflows verified by mocks only until first merge to main + secrets | docs/specs/m0-4-ci.md |
| M1.1 Clients | DONE – review APPROVED, QA PASS, 3 fix rounds (duplicate notice; action errors/focus/CSP/CRLF; expired session) | docs/specs/m1-1-clients.md |
| M1.2 Projects | DONE – review APPROVED, QA PASS, 2 fix rounds (polish: session 4xx rule, filter queue, date min/max; minor: partial date, range/digit messages) | docs/specs/m1-2-projects.md |
| M1.3 Milestones + open debts | review APPROVED (CI green @f779285) – polish round | docs/specs/m1-3-milestones.md |
| M0.2 Supabase local + RLS | DONE – review APPROVED, QA PASS, 1 polish round (email length/format, test hardening), re-review APPROVED | docs/specs/m0-2-supabase-local.md |

## Next step
Owner actions pending: (1) answer whether any migrations were applied manually to staging/prod; (2) create 3 GitHub secrets (docs/setup/github-secrets.md); (3) Google OAuth clients (docs/setup/google-oauth.md); (4) open PR claude/adoring-rubin-yrdzla -> main when ready (first real staging migration run); (5) Netlify account + 2 sites + NETLIFY_AUTH_TOKEN (docs/setup/netlify.md).
VERIFY-02 checked 2026-11-16 (docs/verify/VERIFY-02-netlify.md): commercial use OK, Next 16 supported; OPEN: proxy.ts (Node runtime) on Netlify – gate on first staging deploy; credit budget (hard pause).
Owner approved (2026-11-16): start M1 in parallel; split M1.1 Clients (CLI-1..4), M1.2 Projects (PRJ-1..3), M1.3 Milestones (MS-1..3, MS-6); MS-4/5 move to M2. M0.5 Sentry / M0.6 Netlify wait for owner accounts.
Now: M1.3 polish (sort_order CHECK bound; countFromDb; move_milestone returns new position, no client-side edge short-circuit; robust test cleanup), then re-review (range 5c19fb4..HEAD), QA, then feature PR to main. Owner to confirm M1.3 copy + deviations (100 milestones/project, no warning with 0 milestones, past-due amount-0 = מתוכנן, 'חזרה' dismiss label, view without status column).
Carry into M1.3: isIsoDate uses Date.UTC which maps years 0–99 to 1900s → years 0001–0099 get generic date message instead of range message (use setUTCFullYear). Lead decision: no-JS partial date saved as empty is acceptable (PWA on Chrome always runs JS). Owner to confirm M1.2 Hebrew copy + bounds. Lead concern: criterion 11(a) too narrow – invalid refresh token (AuthApiError 400) should count as 'ended'; only 429/5xx/network = 'unknown'.
Carry into M1.2: checkBrowserSession should return 'ended' only for AuthSessionMissingError or AuthApiError 401/403 (429 currently causes a false redirect); add offline E2E (context.setOffline) asserting no redirect; ref-based in-flight guard in client form (synchronous scripted triple click creates 3 rows). Owner to confirm M1.1 Hebrew copy + choices (search on submit via POST, duplicate check on blur, phone rules, max lengths).
Manual staging check (when Google OAuth + staging exist): allowlisted Google account is created and reaches home – confirms GoTrue sends user_metadata.email_verified (hook fails closed otherwise).
Proposed split: M0.4 CI + Supabase migrations workflows; M0.5 Sentry; M0.6 Netlify staging/prod deploy (needs owner Netlify account + VERIFY-02).
Carry into M0.3: CSP connect-src += Supabase URL; @types/node ^22; focus ring contrast fix; revisit enable_signup for Google OAuth; SQL-level test for missing/empty email claim; optional tests (normal emails accepted, ~3000-char email).
Later (AUTH-5 UI): last-admin protection; trigger-enforced created_by/created_at.
Environment: start Docker with `nohup dockerd >/tmp/dockerd.log 2>&1 &`; use SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io in the cloud sandbox.
