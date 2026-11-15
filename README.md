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
pnpm test:e2e           # end-to-end tests (Playwright, Chromium)
```

The integration tests create their own users through the local admin API and delete them
afterwards. They read the keys from `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY` when all three are set, and otherwise from
`supabase status`. They refuse to run against anything other than localhost.
