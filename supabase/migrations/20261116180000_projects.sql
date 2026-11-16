-- M1.2: projects (SPEC sections 5.3 PRJ-1..3, 5.2 CLI-2/CLI-4 and 6).
--
-- archived_at is an owner-approved addition to SPEC 6 (archiving a project, TASK-10).
-- contract_amount is optional (owner decision) and stored in integer agorot (SPEC 0.6).
-- client_id is ON DELETE RESTRICT: a client with projects cannot be deleted, only archived
-- (CLI-2). Milestones (M1.3) and incomes (M2) will reference projects the same way, which is
-- what stops a project that has them from being deleted.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  client_id uuid not null references public.clients (id) on delete restrict,
  name text not null,
  property_address text,
  status text not null default 'lead',
  contract_amount bigint,
  start_date date,
  end_date date,
  notes text,
  archived_at timestamptz,
  -- Mirrors the shared zod schema (src/lib/projects/schema.ts and src/lib/money.ts).
  constraint projects_name_check check (name = btrim(name) and char_length(name) between 1 and 120),
  constraint projects_property_address_check check (
    property_address = btrim(property_address) and char_length(property_address) between 1 and 200
  ),
  constraint projects_status_check check (
    status in ('lead', 'active', 'on_hold', 'completed', 'cancelled')
  ),
  -- At most ₪99,999,999.99 (MAX_AGOROT), well below Number.MAX_SAFE_INTEGER in the browser.
  constraint projects_contract_amount_check check (contract_amount between 0 and 9999999999),
  constraint projects_start_date_check check (start_date between '1900-01-01' and '2100-12-31'),
  constraint projects_end_date_check check (end_date between '1900-01-01' and '2100-12-31'),
  constraint projects_dates_order_check check (end_date >= start_date),
  constraint projects_notes_check check (notes = btrim(notes) and char_length(notes) between 1 and 2000)
);

comment on table public.projects is
  'Projects of a client (SPEC 5.3). archived_at set = archived (owner decision, M1.2).';
comment on column public.projects.contract_amount is 'Contract amount in agorot (integer); null = not set.';

-- Foreign keys (SPEC 6).
create index projects_client_id_idx on public.projects (client_id, updated_at desc);
create index projects_created_by_idx on public.projects (created_by);
-- Date fields (SPEC 6).
create index projects_start_date_idx on public.projects (start_date);
create index projects_end_date_idx on public.projects (end_date);
create index projects_archived_at_idx on public.projects (archived_at);
-- The list filters by status and is sorted by last update.
create index projects_status_updated_at_idx on public.projects (status, updated_at desc);
create index projects_updated_at_idx on public.projects (updated_at desc);

create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- Owner decision (M1.2): no new project for an archived client. Enforced here rather than
-- only in the Server Action so it holds for every writer, and as a trigger rather than an
-- RLS WITH CHECK because a failed RLS check is a generic 42501 the app could not tell apart
-- from missing access; this raises its own SQLSTATE (HKA01), which the app turns into a
-- clear message. Moving an existing project to an archived client is refused the same way;
-- editing a project whose client was archived later is allowed. FOR SHARE locks the client
-- row until the transaction ends, so the client cannot be archived between this check and
-- the insert.
create function public.projects_require_active_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  client_archived_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then
    return new;
  end if;
  select c.archived_at
  into client_archived_at
  from public.clients as c
  where c.id = new.client_id
  for share;
  if client_archived_at is not null then
    raise exception using
      errcode = 'HKA01',
      message = 'The client is archived; restore it before adding a project.';
  end if;
  return new;
end;
$$;

revoke execute on function public.projects_require_active_client() from public, anon, authenticated;

create trigger projects_require_active_client
before insert or update of client_id on public.projects
for each row execute function public.projects_require_active_client();

-- Row Level Security: allowlisted users (owner and admin) have full access; anon has none.
alter table public.projects enable row level security;

revoke all on table public.projects from public, anon, authenticated;
grant select, delete on table public.projects to authenticated;
-- Column privileges: id, created_at, created_by and updated_at are set by the database only.
grant insert (
  client_id, name, property_address, status, contract_amount, start_date, end_date, notes,
  archived_at
) on table public.projects to authenticated;
grant update (
  client_id, name, property_address, status, contract_amount, start_date, end_date, notes,
  archived_at
) on table public.projects to authenticated;
grant all on table public.projects to service_role;

create policy projects_select_allowed
on public.projects
for select
to authenticated
using ((select public.is_allowed_user()));

create policy projects_insert_allowed
on public.projects
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy projects_update_allowed
on public.projects
for update
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

create policy projects_delete_allowed
on public.projects
for delete
to authenticated
using ((select public.is_allowed_user()));

-- PRJ-1: one page of the project list, newest update first. p_statuses limits the statuses
-- (null = all); p_archived picks the archive or the rest. The query matches part of the
-- project name or the client name, case-insensitively, with LIKE wildcards escaped.
-- SECURITY INVOKER, so RLS applies to both tables. Pages hold at most 100 rows.
create function public.search_projects(
  p_archived boolean,
  p_statuses text[] default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  status text,
  contract_amount bigint,
  updated_at timestamptz,
  client_id uuid,
  client_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pattern as (
    select '%' || replace(replace(replace(coalesce(p_query, ''), '\', '\\'), '%', '\%'), '_', '\_')
      || '%' as value
  )
  select p.id, p.name, p.status, p.contract_amount, p.updated_at, c.id, c.name
  from public.projects as p
  join public.clients as c on c.id = p.client_id
  cross join pattern
  where (case when p_archived then p.archived_at is not null else p.archived_at is null end)
    and (p_statuses is null or p.status = any (p_statuses))
    and (
      coalesce(p_query, '') = ''
      or p.name ilike pattern.value
      or c.name ilike pattern.value
    )
  order by p.updated_at desc, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.search_projects(boolean, text[], text, integer, integer) is
  'PRJ-1: bounded, parameterized project search by project or client name, with status filter.';

revoke execute on function public.search_projects(boolean, text[], text, integer, integer)
  from public, anon;
grant execute on function public.search_projects(boolean, text[], text, integer, integer)
  to authenticated, service_role;
