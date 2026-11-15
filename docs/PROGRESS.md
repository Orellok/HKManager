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
- Owner wants work committed continuously and resumed autonomously after interruptions.

## Status
| Feature | Status | Notes |
|---|---|---|
| M0.1 Scaffold | DONE – review APPROVED, QA PASS, 0 fix rounds | docs/specs/m0-1-scaffold.md |
| M0.2 Supabase local + RLS | implemented (fb275b9, b6c0ede..1664e41) – in code review | docs/specs/m0-2-supabase-local.md |

## Next step
Run code-reviewer on M0.2 (diff 5427a34..HEAD), then QA.
Carry to M0.3: CSP connect-src must include the Supabase URL; @types/node ^20 -> ^22 (Vitest peer warning).
Sandbox note: proxy blocks public.ecr.aws/ghcr.io blobs; run Supabase CLI with SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io in the cloud sandbox only (lead decision, not baked into scripts).
M0.3 items: revisit enable_signup=false vs Google OAuth first sign-in; confirm trusting JWT email claim without verification check.
Before M0.3/M0.4: lead prepares step-by-step Supabase account + staging/production project setup instructions for the owner (owner has no setup yet).
Environment: Docker daemon is not running by default in the cloud container – start it with `nohup dockerd >/tmp/dockerd.log 2>&1 &` before `supabase start`.
QA note for M0.3: default focus outline (outline-ring/50) is too light (<3:1) – fix when the first focusable element (login button) is added.
Non-blocking review notes to carry forward: Tailwind runs via @tailwindcss/turbopack (no postcss config) – consider switching to @tailwindcss/postcss before shadcn components are added; production CSP style-src has no unsafe-inline – watch Recharts/Radix inline styles (M4); widen connect-src for Supabase/Sentry in M0.2/M0.5; @types/node ^20 vs Node 22; unused dark variant in globals.css.

Note: shadcn CLI cannot reach ui.shadcn.com from the cloud sandbox (proxy 403) – components must be added manually or the host allowed.
Before starting M0.2: draft its acceptance criteria and get owner approval (per feature.md).
