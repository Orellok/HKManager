# M0.1 – Scaffold

Source: SPEC.md sections 0, 7, 8, 10, 11 (M0). Approved by the owner on 2026-11-15.

## Acceptance criteria

1. Next.js 16 project with App Router, TypeScript strict, pnpm. Folder layout per `.claude/project-profile.md` (`src/`, `src/components/ui/`, `tests/`).
2. Scripts `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm test` (Vitest), `pnpm test:e2e` (Playwright, Chromium only), `pnpm build` exist and pass.
3. Tailwind CSS + shadcn/ui installed, with a minimal neutral set of design tokens in `src/app/globals.css`. Recharts and zod are NOT installed in this feature.
4. RTL shell: `<html lang="he" dir="rtl">`, a font that supports Hebrew, a base layout with the title "HKManager" in a header and a main content area with accessible landmarks. No navigation menu (owner decision). No horizontal page scroll at 360, 412 and 1280 px.
5. Indexing blocked (SPEC 8): every response, including 404, carries `X-Robots-Tag: noindex, nofollow`; `/robots.txt` returns `Disallow: /` for all agents; pages include meta robots `noindex, nofollow`. No business name or business details anywhere – only "HKManager".
6. Security headers: Content-Security-Policy using a per-request nonce (owner decision: nonce-based CSP, dynamic rendering accepted), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `frame-ancestors 'none'` (plus `X-Frame-Options: DENY`), `Permissions-Policy`.
7. Tests: at least one sample Vitest unit test; a Playwright E2E test verifying criteria 4–6 on an Android viewport and on desktop.
8. Out of scope here: Supabase, Auth, Sentry, PWA, CI (features M0.2–M0.5, M7).
