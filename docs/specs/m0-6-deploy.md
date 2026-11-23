# M0.6 – Netlify deploy (staging + production)

Source: SPEC.md sections 3, 7, 8, 11, 13 (VERIFY-02), `docs/verify/VERIFY-02-netlify.md`, `docs/setup/netlify.md`. Criteria set by the lead under the owner's pre-approval (2026-11-23).

## Acceptance criteria
1. Netlify build config committed (`netlify.toml`), using Netlify's official Next.js runtime/adapter for Next 16. Any added package is the official Netlify adapter only, pinned exactly.
2. GitHub Actions deploys, never Netlify's Git integration:
   - **Staging:** after the staging-migrations workflow succeeds for a commit on `main` (and only if that commit is still main's head), build with the staging public env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` from GitHub *variables*, not secrets) and deploy to the staging site.
   - **Production:** manual `workflow_dispatch`, only for a commit whose staging deploy succeeded (same guard style as production migrations), deploying to the production site with production public env.
3. Secrets/variables: `NETLIFY_AUTH_TOKEN` (secret); site IDs and public Supabase values as repository variables. Missing values fail with a clear message naming them, never printing values. Minimal permissions, actions pinned to SHAs.
4. VERIFY-02 gate – post-deploy smoke check in the workflow against the deployed URL: `/robots.txt` disallows all; every checked response has `X-Robots-Tag: noindex, nofollow`; `/` without a session redirects to `/login` (proves `proxy.ts` runs on Netlify); `/login` returns 200 with a nonce-based CSP header matching the page's script nonces; a prefetch-header request to `/` gets no page content. Failing smoke = failed deploy.
5. Credit budget: staging deploys only on `main` (no deploy previews); concurrency so deploys never overlap.
6. Docs: owner checklist in Hebrew (`docs/setup/deploy.md`): which GitHub variables/secrets to add, Supabase URL Configuration (Site URL + redirect URLs for the Netlify domains), Google OAuth origins, allowlist emails, and the manual first-run checks (Google sign-in, one PDF receipt, one expense photo, Push later).
7. Local checks still pass; workflows validated with actionlint + shellcheck; smoke script unit-testable against a local production server.
8. Out of scope: Sentry (M0.5), PWA/Push (M7), custom domain.
