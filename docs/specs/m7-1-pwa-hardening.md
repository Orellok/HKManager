# M7.1 – PWA, keep-alive, hardening carry-overs

Source: SPEC.md sections 2 (platform, app name), 7 (PWA: manifest + service worker, static-asset cache, no offline data), 8 (security headers), 9 (availability / keep-alive, VERIFY-01), docs/PROGRESS.md lead decisions 2026-11-23 (M7 split, VERIFY-01) and the "Carry into" lines. Criteria set by the lead under the owner's pre-approval. Push (NOTIF-4..16, `push` / `notificationclick`), backups and the production deploy are M7.2–M7.4. The in-app install suggestion is NOTIF-13 (M7.2); M7.1 relies on Chrome's own install UI.

## Acceptance criteria

### PWA
1. Manifest at `/manifest.webmanifest` (Next metadata route, linked from every page): `name` and `short_name` "HKManager", `lang` "he", `dir` "rtl", `start_url` "/", `scope` "/", `id` "/", `display` "standalone", theme and background colors from the design tokens; icons 192 and 512 PNG (`any`) and a 512 maskable PNG.
2. Icons are generated in the repo by a script with no new dependency (`scripts/generate-icons.mts`, Node built-ins only); the PNGs are committed under `public/icons/`. A unit test checks that the committed files match the generator output (valid PNG, right size).
3. Service worker `/sw.js` (static file): on `fetch`, only same-origin GET requests under `/_next/static/` and `/icons/` are served cache-first and stored in a versioned cache; every other request (pages, RSC payloads, Server Actions, Route Handlers, Supabase, files) is not intercepted, so no data and no HTML is ever cached and nothing works offline. Only `ok`, `basic` responses are stored; the cache is capped (oldest entries removed); old cache versions are deleted on `activate`. No `push` / `notificationclick` handlers (M7.2).
4. Registration from a client component in the root layout, production builds only, `scope: "/"`, `updateViaCache: "none"`; a failed registration is ignored silently (the app works without it). Works with the nonce CSP: the CSP gains an explicit `worker-src 'self'` and `manifest-src 'self'`.
5. `/manifest.webmanifest`, `/sw.js` and `/icons/*` are reachable without a session (excluded from the proxy matcher; they carry no data) and keep the static security headers incl. `X-Robots-Tag: noindex, nofollow`; `/sw.js` is served with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`. `scripts/smoke-deploy.mts` checks both URLs (200, content type, X-Robots-Tag).
6. Viewport `themeColor` set; Chrome installability (manifest + icons + SW) verified by an E2E test that reads the manifest, checks the icons load, and sees the service worker activate on a production build.

### Keep-alive (VERIFY-01 lead decision)
7. `.github/workflows/keep-alive.yml`: cron Sun, Wed and Fri (UTC) plus manual dispatch; one job per environment (staging, production), each running a read-only `select 1` through the pinned Supabase CLI (`supabase db query --remote=<ref> --read-only`) with the existing `SUPABASE_ACCESS_TOKEN` secret. Output is discarded; the log prints only the environment name and pass/fail. A missing token fails the job with the secret's name (it is required for migrations anyway); one environment failing does not stop the other. Minimal permissions (`contents: read`), timeout, no artifacts. Documented in `docs/setup/keep-alive.md` incl. GitHub's 60-day inactivity auto-disable of scheduled workflows on public repos.

### Hardening carry-overs
8. Idempotent create (lost response): every create form (clients, projects, milestones, incomes, expenses, tasks) carries a server-generated `create_key` (UUID, hidden field, new per page render). The tables get a nullable unique `create_key` column (migration). A repeated submit with the same key does not create a second row: the action answers as if it had saved and goes to the existing row. An invalid or missing key saves without idempotency (pages open before the deploy keep working). Edits are unaffected.
9. A file path an expense ever recorded (`recorded_expense_files`) cannot be recorded by another expense, also via the API (new SQLSTATE `HKE04`, shown as a field error on the file); the same expense may re-record its own old path.
10. Calendar week view: the priority and overdue pills never overflow a narrow week column (wrap inside the column).
11. Calendar month view: choosing a day with the keyboard (or a click) keeps focus on that day's link after the view reloads, and the page does not scroll to the top.
12. Editing a task opened from the calendar returns to the calendar (same view and date) after save, delete or cancel.
13. Already done in earlier features, re-verified by their existing tests (no change): expenses row hover contrast (M4.1, `expenses.spec.ts`), focus to the camera input after a photo error (M4.1), "עוד" closes on focus-out (M3-9, `settings.spec.ts`), export date carry-overs (M6-12, `tasks.spec.ts`), staging-deploy concurrency at job level (`staging-deploy.yml`).

### General
14. No new dependency. RTL, WCAG 2.1 AA, no horizontal scroll at 360/412/1280. Tests: unit (manifest, CSP directives, idempotency helpers, return paths, icons, SW logic where testable), integration (create_key uniqueness per table, save_income with a repeated key, HKE04), E2E (manifest/SW/icons without a session, duplicate submit with the same key, calendar focus and return, week pill). Names include M7.1-n.
