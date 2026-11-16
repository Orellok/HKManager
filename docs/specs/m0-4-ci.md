# M0.4 – CI (GitHub Actions) + Supabase migration workflows

Source: SPEC.md sections 0 (rules 5, 7), 7 (CI, environments), 10. Approved by the owner on 2026-11-16.
Revised M0 split (owner-approved): M0.4 CI + migrations; M0.5 Sentry; M0.6 Netlify staging/production deploy (needs owner Netlify account + VERIFY-02).

## Acceptance criteria

1. CI workflow `.github/workflows/ci.yml` on every push and pull request: pnpm install with the frozen lockfile (with caching), Prettier check, lint, typecheck, unit tests, start local Supabase (CLI default registry), integration tests, build, E2E (Playwright, Chromium only, `--trace off`). Any failure fails the run. Node and pnpm versions match the project.
2. Staging migrations workflow: runs on push to `main` only after CI succeeds for that commit, and applies pending migrations to the staging project (`tmistmqyqcnjftovxyoy`) with the Supabase CLI.
3. Production migrations workflow: manual only (`workflow_dispatch`), applies migrations to production (`gnjdyiujvxbwhxmldgfn`), and refuses to run unless the same commit's staging migration run succeeded (or an equivalent verifiable guard).
4. Secrets only in GitHub Secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_DB_PASSWORD`, `SUPABASE_PROD_DB_PASSWORD`); project refs as non-secret values. Nothing secret in the repository or logs. Workflow permissions minimal (`contents: read`), third-party actions pinned to a full commit SHA.
5. Documentation: a setup guide (Hebrew) for the owner to create the three secrets; README section describing the workflows.
6. Out of scope: Netlify deploy (M0.6), Sentry (M0.5), seeding real data.
