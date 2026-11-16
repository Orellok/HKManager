# HKManager

## Local database (Supabase)

The local stack runs in Docker through the Supabase CLI, which is a devDependency.

Requirements: Node 22, pnpm 10 and a running Docker daemon.

```bash
pnpm install
pnpm db:start   # start the local stack; applies supabase/migrations and supabase/seed.sql
pnpm db:reset   # recreate the local database from the migrations and the seed
pnpm db:stop    # stop the local stack
```

`pnpm exec supabase status` prints the local URLs and keys. Copy `.env.example` to `.env.local`
and fill it in from that output: `API_URL` goes to `NEXT_PUBLIC_SUPABASE_URL`, `ANON_KEY` to
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SERVICE_ROLE_KEY` to `SUPABASE_SERVICE_ROLE_KEY`.
Studio runs at http://127.0.0.1:54323.

Schema changes are made only through SQL migrations in `supabase/migrations/`
(`pnpm exec supabase migration new <name>`), never by editing a database by hand.

### Sign-in (Supabase Auth)

- Google Sign-In is the only way in (SPEC section 2). Locally it needs the
  `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` variables
  when `pnpm db:start` runs (see `.env.example`); without them the stack starts and only the
  real Google round-trip fails.
- A "before user created" hook (`public.hook_before_user_created`, wired in
  `supabase/config.toml`) lets Supabase Auth create only Google accounts that are on the
  allowlist. Email/password sign-up is rejected for everyone. Local test users are created
  through the admin API, which does not pass through the hook.
- Staging and production are configured in the Supabase dashboard:
  `docs/setup/supabase-auth.md`.

### Restricted networks (optional)

By default the CLI pulls its images from public.ecr.aws. If that registry is blocked on your
network, the same official images can be pulled from Docker Hub for that one run:

```bash
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io pnpm db:start
```

### Allowlist

Only the email addresses in `public.allowed_users` can use the app (SPEC section 2).
`supabase/seed.sql` contains fictitious addresses only. Real addresses are never committed;
insert them separately in each environment. Run this SQL as the database owner, replacing
the placeholder address and role (`owner` or `admin`):

```sql
insert into public.allowed_users (email, role)
values ('person@example.com', 'owner')
on conflict ((lower(email))) do update set role = excluded.role;
```

- Local: `pnpm exec supabase db query "<the SQL above>"`. `pnpm db:reset` deletes the rows, so
  run it again after a reset.
- Staging and production: run the SQL in the project's SQL Editor in the Supabase dashboard.

## Tests

```bash
pnpm test               # unit tests (Vitest), no database needed
pnpm test:integration   # integration tests (Vitest) against the local stack; run pnpm db:start first
pnpm test:e2e           # end-to-end tests (Playwright, Chromium); run pnpm db:start first
```

The E2E tests build and start the app against the local stack and sign in without Google:
a fixture creates a test account through the local admin API and sets the session cookies
in the browser.

The integration tests create their own users through the local admin API and delete them
afterwards. They read the keys from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY` when all three are set, and otherwise from
`supabase status`. They refuse to run against anything other than localhost.

## CI and database migrations (GitHub Actions)

Three workflows live in `.github/workflows/`. Every third-party action is pinned to a full
commit SHA, and every workflow runs with read-only repository permissions.

| Workflow | Runs | What it does |
|---|---|---|
| `ci.yml` (CI) | every push and pull request | `pnpm install --frozen-lockfile`, Prettier check, lint, typecheck, unit tests, starts the local Supabase stack, integration tests, build, then Playwright E2E (Chromium, `--trace off`). Any failing step fails the run. |
| `staging-migrations.yml` | after CI succeeds for a push to `main` | Checks out that exact commit, links the staging project (`tmistmqyqcnjftovxyoy`) and runs `supabase db push --remote`. |
| `production-migrations.yml` | manually (Actions → Run workflow, branch `main`) | Refuses to run unless a successful staging migrations run exists for the same commit, then links production (`gnjdyiujvxbwhxmldgfn`) and runs `supabase db push --remote`. |

- Node 22 and the pnpm version from `package.json` are used everywhere. The Supabase CLI comes
  from the devDependency (`pnpm exec supabase`), so CI and the migrations use one CLI version.
- The migrations workflows use a concurrency group per environment: runs never overlap; a newer
  queued run replaces an older queued one.
- The staging workflow skips the migrate job when the commit is no longer the head of `main`
  (the newer commit's run applies every pending migration once its CI passes; if that CI fails,
  staging waits for the next green commit on `main`). A skipped job never counts as a
  successful staging migration.
- The production guard reads the staging runs through the Actions API (`actions: read`). Each
  staging run is titled `Staging migrations <commit SHA>`, and the guard requires a run with that
  exact title whose `Apply migrations to staging` job succeeded (not skipped).
- `supabase db push` applies only the pending files in `supabase/migrations/` and records them
  in the project's migration history. It does not push the auth settings in
  `supabase/config.toml` (the before-user-created hook, providers, redirect URLs), which stay
  manual (`docs/setup/supabase-auth.md`), and it does not run `supabase/seed.sql`.
- Secrets live only in GitHub Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_STAGING_DB_PASSWORD`
  and `SUPABASE_PROD_DB_PASSWORD`. Setup guide (Hebrew): `docs/setup/github-secrets.md`.
