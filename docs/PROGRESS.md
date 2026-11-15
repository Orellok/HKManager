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
- 2026-11-15: owner created Supabase projects hkmanager-staging and hkmanager-prod (Free plan → 2 free projects confirmed in practice). Project refs/URLs: pending from owner.
- Owner wants work committed continuously and resumed autonomously after interruptions.

## Status
| Feature | Status | Notes |
|---|---|---|
| M0.1 Scaffold | DONE – review APPROVED, QA PASS, 0 fix rounds | docs/specs/m0-1-scaffold.md |
| M0.2 Supabase local + RLS | DONE – review APPROVED, QA PASS, 1 polish round (email length/format, test hardening), re-review APPROVED | docs/specs/m0-2-supabase-local.md |

## Next step
Owner to approve M0.3 (Auth) criteria – drafted in chat 2026-11-15; open decision: block non-allowlisted Google accounts at user creation (Supabase "before user created" auth hook) vs. sign-out only. Pending from owner: Supabase project IDs/URLs.
Carry into M0.3: CSP connect-src += Supabase URL; @types/node ^22; focus ring contrast fix; revisit enable_signup for Google OAuth; SQL-level test for missing/empty email claim; optional tests (normal emails accepted, ~3000-char email).
Later (AUTH-5 UI): last-admin protection; trigger-enforced created_by/created_at.
Environment: start Docker with `nohup dockerd >/tmp/dockerd.log 2>&1 &`; use SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io in the cloud sandbox.
