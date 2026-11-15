# Project Profile

<!-- The ONLY file you edit per project. Save as .claude/project-profile.md in the project root.
     Every agent reads this first. Leave a field as "none" rather than deleting it. -->

## Spec
<!-- The agents build from this. Put the spec file in the project and point to it here. -->
- Spec file: SPEC.md (repository root)
- Supporting material: none
- Acceptance criteria: requirement IDs in SPEC.md section 5 and tests in section 10. Per-feature numbered criteria are drafted by the lead for owner approval and saved in docs/specs/
- Out of scope: everything in SPEC.md section 1 "Non-goals"; stage-2 items (DOC-7..9 API mode is design-only, `leads` table and website endpoint in 9.3 must not be created); iOS/Safari support of any kind. M5 is blocked until VERIFY-03 is closed; M7 until VERIFY-01, 02, 04, 05 are closed. Any OPEN-xx / VERIFY-xx item stops work and goes to the owner (SPEC.md section 0)

## Stack
- Language: TypeScript, strict mode (use the TypeScript major officially supported by the chosen Next.js version)
- Framework: Next.js 16 (App Router, Server Components, Server Actions / Route Handlers)
- UI layer: React + Tailwind CSS + shadcn/ui + Recharts; full RTL (`dir="rtl"`, `lang="he"`), mobile-first
- Data layer: Supabase (Postgres with RLS, Auth, Storage, Edge Functions); schema changes via Supabase CLI migrations only; validation with zod shared by client and server
- Package manager: pnpm

## Commands
- Install: `pnpm install`
- Run dev server: `pnpm dev` (URL: http://localhost:3000)
- Build: `pnpm build`
- Lint: `pnpm lint`
- Format: `pnpm format`
- Type check: `pnpm typecheck`
- Unit tests: `pnpm test`
- E2E tests: `pnpm test:e2e` (Playwright, Chromium only; pass `--trace off` unless debugging)

## Testing
- Unit test tool: Vitest (unit, and integration against local Supabase)
- E2E tool: Playwright, Chromium only, Android viewport and desktop. No WebKit/Safari
- Test file location and naming: unit tests next to source as `*.test.ts(x)`; integration in `tests/integration/*.test.ts`; E2E in `tests/e2e/*.spec.ts`. Test names include the requirement ID (e.g. `MS-2: ...`)
- Browser MCP available for manual QA: no (use Playwright scripts with the pre-installed Chromium)

## Structure
- Source root: src/
- UI components: src/components/ (shadcn/ui primitives in src/components/ui/)
- Design tokens / theme: src/app/globals.css (Tailwind v4 theme tokens)
- Specs folder: docs/specs/ (the lead saves approved acceptance criteria here)

## Conventions
- Branching and commits: work on the session branch assigned by the environment; Conventional Commits
- Style guide beyond the linter: SPEC.md section 0 (money as integer agorot, no float; migrations only; no unlisted dependencies or services)
- Design source: none (neutral, clean UI per SPEC.md section 7)
- Supported viewports: 360, 412 (Android), 1280 (desktop)
- Languages and direction: he RTL only; ₪ only; DD/MM/YYYY; week starts Sunday; timezone Asia/Jerusalem

## Do not touch
- SPEC.md (owner-only)
- .claude/agents/, .claude/commands/, .claude/skills/
