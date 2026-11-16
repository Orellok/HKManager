-- M1.1: clients (SPEC sections 5.2 CLI-1..4 and 6).
--
-- Phone search (CLI-3) matches on digits only, so "0501234567" finds "050-123-4567". The
-- digits are kept in a stored generated column instead of calling regexp_replace in the query:
-- the normalization is written once, next to the data, every reader gets the same result, and
-- a search does not re-run a regular expression over every row. Search is a substring match,
-- which no btree index can serve; with the expected size of this table (hundreds of rows) a
-- scan of the filtered list is cheap, and a trigram index is not needed (M1.1 decision).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  archived_at timestamptz,
  phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored,
  -- Mirrors the shared zod schema (src/lib/clients/schema.ts): trimmed, bounded values, and
  -- null rather than an empty string for a missing optional field.
  constraint clients_name_check check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint clients_phone_check check (
    phone = btrim(phone) and char_length(phone) between 1 and 30 and phone ~ '^[0-9 +-]+$'
  ),
  constraint clients_email_check check (
    email = btrim(email) and char_length(email) between 3 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  constraint clients_address_check check (address = btrim(address) and char_length(address) between 1 and 200),
  constraint clients_notes_check check (notes = btrim(notes) and char_length(notes) between 1 and 2000)
);

comment on table public.clients is
  'Clients of the business (SPEC 5.2). archived_at set = archived (CLI-2).';
comment on column public.clients.phone_digits is
  'Digits of phone only, for separator-insensitive phone search (CLI-3).';

-- The list is ordered by name, and the duplicate-name warning looks names up case-insensitively.
create index clients_name_lower_idx on public.clients (lower(name));
-- Active and archived lists filter on archived_at (a date field, SPEC 6).
create index clients_archived_at_idx on public.clients (archived_at);
-- Foreign key (SPEC 6).
create index clients_created_by_idx on public.clients (created_by);

create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

-- Row Level Security: allowlisted users (owner and admin) have full access; anon has none.
alter table public.clients enable row level security;

revoke all on table public.clients from public, anon, authenticated;
grant select, delete on table public.clients to authenticated;
-- Column privileges: id, created_at, created_by and updated_at are set by the database only.
grant insert (name, phone, email, address, notes, archived_at) on table public.clients to authenticated;
grant update (name, phone, email, address, notes, archived_at) on table public.clients to authenticated;
grant all on table public.clients to service_role;

create policy clients_select_allowed
on public.clients
for select
to authenticated
using ((select public.is_allowed_user()));

create policy clients_insert_allowed
on public.clients
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy clients_update_allowed
on public.clients
for update
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

create policy clients_delete_allowed
on public.clients
for delete
to authenticated
using ((select public.is_allowed_user()));

-- CLI-3: one page of the active or archived list, optionally filtered by a name substring
-- (case-insensitive) or a phone digit substring. SECURITY INVOKER, so RLS applies. All input
-- arrives as parameters; LIKE wildcards in the name query are escaped and match literally.
create function public.search_clients(
  p_archived boolean,
  p_name_query text default null,
  p_phone_digits text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.clients as c
  where (case when p_archived then c.archived_at is not null else c.archived_at is null end)
    and (
      (coalesce(p_name_query, '') = '' and coalesce(p_phone_digits, '') = '')
      or (
        coalesce(p_name_query, '') <> ''
        and c.name ilike
          '%' || replace(replace(replace(p_name_query, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      or (
        coalesce(p_phone_digits, '') ~ '^[0-9]+$'
        and c.phone_digits like '%' || p_phone_digits || '%'
      )
    )
  order by lower(c.name), c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.search_clients(boolean, text, text, integer, integer) is
  'CLI-3: bounded, parameterized client search by name substring or phone digits.';

-- Duplicate-name warning (M1.1 owner decision): clients whose name has the given key, the
-- output of duplicateNameKey() in src/lib/clients/duplicate-name.ts (trimmed, lower case).
create function public.find_clients_by_name_key(p_name_key text, p_exclude_id uuid default null)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.clients as c
  where lower(c.name) = p_name_key
    and (p_exclude_id is null or c.id <> p_exclude_id)
  order by c.archived_at nulls first, c.id
  limit 5;
$$;

comment on function public.find_clients_by_name_key(text, uuid) is
  'Clients with the same case-insensitive, trimmed name (duplicate warning, M1.1).';

-- Supabase grants EXECUTE on new public functions to anon by default; only signed-in users
-- may call these (RLS then limits rows to allowlisted users).
revoke execute on function public.search_clients(boolean, text, text, integer, integer)
  from public, anon;
revoke execute on function public.find_clients_by_name_key(text, uuid) from public, anon;
grant execute on function public.search_clients(boolean, text, text, integer, integer)
  to authenticated, service_role;
grant execute on function public.find_clients_by_name_key(text, uuid)
  to authenticated, service_role;
