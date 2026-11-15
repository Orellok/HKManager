-- M0.2: base schema – roles, allowlist, updated_at trigger, authorization helpers and RLS.
-- SPEC sections 2, 5.1 (AUTH-4) and 6.

-- Roles (SPEC section 2).
create type public.app_role as enum ('owner', 'admin');

-- Reusable trigger function that keeps updated_at current on every UPDATE.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Triggers do not need EXECUTE at fire time; nobody should call it directly.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Allowlist of the users who may access the app (SPEC sections 2 and 6).
create table public.allowed_users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  email text not null,
  role public.app_role not null,
  constraint allowed_users_email_format check (email = btrim(email) and email like '_%@_%')
);

comment on table public.allowed_users is
  'Closed allowlist of app users (SPEC section 2). Matched case-insensitively against the JWT email.';

-- Emails are unique case-insensitively.
create unique index allowed_users_email_lower_key on public.allowed_users (lower(email));

create trigger allowed_users_set_updated_at
before update on public.allowed_users
for each row execute function public.set_updated_at();

-- Authorization helpers. SECURITY DEFINER so they can read allowed_users regardless of the
-- caller's RLS, with an empty search_path and fully qualified names.
create function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_users as au
    where lower(au.email) = lower(auth.jwt() ->> 'email')
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_users as au
    where lower(au.email) = lower(auth.jwt() ->> 'email')
      and au.role = 'admin'::public.app_role
  );
$$;

revoke execute on function public.is_allowed_user() from public, anon;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_allowed_user() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;

-- Row Level Security (AUTH-4): anon has no access; authenticated users need the allowlist.
alter table public.allowed_users enable row level security;

revoke all on table public.allowed_users from public, anon, authenticated;
grant select, insert, update, delete on table public.allowed_users to authenticated;
grant all on table public.allowed_users to service_role;

create policy allowed_users_select_allowed
on public.allowed_users
for select
to authenticated
using ((select public.is_allowed_user()));

create policy allowed_users_insert_admin
on public.allowed_users
for insert
to authenticated
with check ((select public.is_admin()));

create policy allowed_users_update_admin
on public.allowed_users
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy allowed_users_delete_admin
on public.allowed_users
for delete
to authenticated
using ((select public.is_admin()));
