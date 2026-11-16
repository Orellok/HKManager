# M0.3 – Auth: Google Sign-In + allowlist + protected routes + admin guard

Source: SPEC.md sections 2, 5.1 (AUTH-1..5), 7, 8, 10. Approved by the owner on 2026-11-15.

## Acceptance criteria

1. `@supabase/ssr` + `@supabase/supabase-js` as runtime dependencies; server, browser and proxy Supabase clients configured from env (`.env.example` updated if needed).
2. `/login` screen: a single "כניסה עם Google" button; no business name; RTL; accessible (WCAG 2.1 AA). Fix the default focus indicator contrast (QA note from M0.1: `outline-ring/50` < 3:1).
3. AUTH-1: Google OAuth through Supabase Auth (`signInWithOAuth`), callback route exchanges the code and redirects to `/`.
4. AUTH-2: allowlist enforced server-side.
   - **Owner decision (option A):** non-allowlisted accounts are blocked at user creation with a Supabase "before user created" auth hook that rejects any email not in `allowed_users` (case-insensitive). Implemented via migration + `config.toml`; verified locally. If the hook proves unavailable or unworkable, STOP and report to the lead (fallback B = sign-out only requires owner approval).
   - Defense in depth: after callback and on every protected request the server checks `is_allowed_user()`; if false the session is deleted (sign-out) and the "אין הרשאה" screen is shown with an option to try another account.
   - Revisit `enable_signup` so allowlisted users can complete first Google sign-in while email/password signup stays closed.
5. AUTH-3: every route except `/login`, the auth callback, the "אין הרשאה" screen and `/robots.txt` is protected. Unauthenticated requests are redirected to `/login`. The server validates the user with Supabase (`getUser`/claims verification), never trusting an unverified cookie. No data is rendered without a valid session.
6. AUTH-5: a server-side `requireAdmin()` guard (uses `is_admin()`), with tests. Applied to settings screens when they are built – no placeholder settings screen now.
7. "יציאה" (sign out) button in the header for a signed-in user.
8. Security: CSP `connect-src` allows the configured Supabase URL only (plus 'self'); a SQL-level integration test that a JWT with a missing/empty email claim gets no access. Bump `@types/node` to ^22.
9. Tests: unit for the access-decision logic; integration for the auth hook (allowlisted email created, non-allowlisted rejected, case-insensitive); E2E: unauthenticated → `/login`; allowlisted user (session created against local Supabase) sees home; non-allowlisted session → "אין הרשאה" and session cleared; owner blocked by `requireAdmin()`. Real Google sign-in is verified manually later (needs Google OAuth clients from the owner).
10. Out of scope: staging deploy (M0.4 / Netlify), settings screens, Google Calendar scopes.
