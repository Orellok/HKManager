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
| M0.1 Scaffold | implemented (commits 6137e2d..9a4f879) – in code review | docs/specs/m0-1-scaffold.md |

## Next step
Run code-reviewer on M0.1 (diff 3ef3132..HEAD), then QA.

Note: shadcn CLI cannot reach ui.shadcn.com from the cloud sandbox (proxy 403) – components must be added manually or the host allowed.
Before starting M0.2: draft its acceptance criteria and get owner approval (per feature.md).
