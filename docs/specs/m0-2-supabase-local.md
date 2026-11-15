# M0.2 – Supabase local + base migration + RLS

Source: SPEC.md sections 0 (rules 3, 5), 2, 5.1 (AUTH-4), 6, 7, 10 (Integration). Approved by the owner on 2026-11-15.

## Acceptance criteria

1. Supabase CLI installed as a devDependency (SPEC 7: "Local (Supabase CLI)"). `supabase/config.toml` committed. Scripts: `pnpm db:start`, `pnpm db:stop`, `pnpm db:reset`. Schema changes only via SQL migrations in `supabase/migrations/`.
2. Base migration creates:
   - an `app_role` type with values `owner`, `admin`;
   - table `allowed_users` with the common fields (`id uuid pk`, `created_at`, `updated_at`, `created_by`), `email` unique case-insensitively, `role app_role not null`;
   - a reusable trigger function that maintains `updated_at`, attached to `allowed_users`.
3. Authorization helper functions `is_allowed_user()` and `is_admin()` that check the authenticated user's email (from the JWT) against `allowed_users` case-insensitively. They are `security definer` with a fixed `search_path`, `stable`, and not executable by `anon`.
4. RLS enabled on `allowed_users`:
   - `anon`: no access;
   - `authenticated` not in the allowlist: cannot read or write;
   - `owner`: read only;
   - `admin`: read and write (insert/update/delete).
5. A guard test that fails if any table in the `public` schema has RLS disabled (enforces AUTH-4 for all future tables).
6. Integration tests (Vitest, against local Supabase) for every case in criterion 4, named with requirement IDs (e.g. `AUTH-4: ...`). New script `pnpm test:integration`; `pnpm test` stays DB-free and fast. Test users are created locally (e.g. email/password via the local admin API) – local only.
7. Real email addresses are never committed. `supabase/seed.sql` uses fictitious addresses only. A documented command/procedure inserts the real allowlist per environment.
8. `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (no real values). README section explaining local DB setup and the test commands.
9. Out of scope: staging/production Supabase projects (need the owner's account – separate step; the lead will prepare setup instructions), login UI / Google Auth (M0.3), any other table (each is created in its own feature).
