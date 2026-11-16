-- M1.3: payment milestones and open debts (SPEC sections 5.4 MS-1..3, MS-6 and 6).
--
-- project_id is ON DELETE RESTRICT: a project with milestones cannot be deleted (the project
-- card then says so), only archived. amount is integer agorot (SPEC 0.6) with the same bounds
-- as a project's contract amount.
--
-- Order (MS-1): sort_order is managed by the database. A new milestone goes last (trigger
-- below) and move_milestone() swaps a milestone with its neighbour. Both lock the project row
-- first, so writers of one project's order run one at a time, and (project_id, sort_order) is
-- unique, so two milestones can never share a place. Deleting a milestone leaves a gap; gaps
-- never matter because the order is read with ORDER BY and a move swaps with the nearest
-- neighbour, not with "sort_order ± 1".
--
-- Status (MS-2) is computed, never stored: see milestone_balances below and
-- src/lib/milestones/status.ts.

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  project_id uuid not null references public.projects (id) on delete restrict,
  description text not null,
  amount bigint not null,
  due_date date not null,
  sort_order integer not null,
  cancelled_at timestamptz,
  -- Mirrors the shared zod schema (src/lib/milestones/schema.ts and src/lib/money.ts).
  constraint milestones_description_check check (
    description = btrim(description) and char_length(description) between 1 and 200
  ),
  -- At most ₪99,999,999.99 (MAX_AGOROT), as projects.contract_amount.
  constraint milestones_amount_check check (amount between 0 and 9999999999),
  constraint milestones_due_date_check check (due_date between '1900-01-01' and '2100-12-31'),
  constraint milestones_sort_order_check check (sort_order >= 1),
  -- Deferrable so that move_milestone() can swap two places in one UPDATE statement (a
  -- non-deferrable unique constraint is checked row by row and would reject the swap).
  constraint milestones_project_sort_order_key unique (project_id, sort_order)
    deferrable initially immediate
);

comment on table public.milestones is
  'Payment milestones of a project (SPEC 5.4). cancelled_at set = cancelled (MS-2).';
comment on column public.milestones.amount is 'Amount in agorot (integer).';
comment on column public.milestones.sort_order is
  'Place in the project''s list (MS-1), set by the database; unique per project, gaps allowed.';

-- Foreign key project_id (SPEC 6): served by the unique (project_id, sort_order) index, whose
-- leading column is project_id; it also returns a project's milestones already in order.
create index milestones_created_by_idx on public.milestones (created_by);
-- Date field (SPEC 6); the open debts screen (MS-6) filters and sorts by it.
create index milestones_due_date_idx on public.milestones (due_date);

create trigger milestones_set_updated_at
before update on public.milestones
for each row execute function public.set_updated_at();

-- A project holds at most this many milestones (M1.3 bound), so the project card can read
-- all of them in one bounded query and sum them exactly.
-- Raised as HKM01 so the app can show its own message.
create function public.milestones_assign_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  milestone_count integer;
  last_place integer;
begin
  -- Serializes inserts and moves of the same project (see move_milestone). FOR NO KEY UPDATE
  -- does not block the foreign key checks of other tables (they take FOR KEY SHARE).
  perform 1 from public.projects as p where p.id = new.project_id for no key update;
  select count(*), coalesce(max(m.sort_order), 0)
  into milestone_count, last_place
  from public.milestones as m
  where m.project_id = new.project_id;
  if milestone_count >= 100 then
    raise exception using
      errcode = 'HKM01',
      message = 'The project already has the maximum number of milestones.';
  end if;
  new.sort_order := last_place + 1;
  return new;
end;
$$;

revoke execute on function public.milestones_assign_sort_order() from public, anon, authenticated;

create trigger milestones_assign_sort_order
before insert on public.milestones
for each row execute function public.milestones_assign_sort_order();

-- Row Level Security: allowlisted users (owner and admin) have full access; anon has none.
alter table public.milestones enable row level security;

revoke all on table public.milestones from public, anon, authenticated;
grant select, delete on table public.milestones to authenticated;
-- Column privileges: id, created_at, created_by, updated_at and sort_order are set by the
-- database on insert. sort_order can be updated because move_milestone() runs with the
-- caller's privileges (SECURITY INVOKER, so RLS applies); the unique constraint still
-- refuses a duplicate place. A milestone never moves to another project.
grant insert (project_id, description, amount, due_date, cancelled_at)
  on table public.milestones to authenticated;
grant update (description, amount, due_date, cancelled_at, sort_order)
  on table public.milestones to authenticated;
grant all on table public.milestones to service_role;

create policy milestones_select_allowed
on public.milestones
for select
to authenticated
using ((select public.is_allowed_user()));

create policy milestones_insert_allowed
on public.milestones
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy milestones_update_allowed
on public.milestones
for update
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

create policy milestones_delete_allowed
on public.milestones
for delete
to authenticated
using ((select public.is_allowed_user()));

-- SPEC 6: amount, paid and balance of every milestone. M1.3 has no incomes yet, so paid is 0
-- and the balance is the amount; M2 replaces the two expressions with the sum of the linked
-- incomes, and every reader (project card, open debts) gets the new numbers unchanged.
-- security_invoker: the view reads milestones with the caller's privileges, so RLS applies
-- (a plain view would run as its owner and bypass RLS).
-- The status itself depends on "today" in Asia/Jerusalem, which the app computes on the
-- server from an injectable clock (src/lib/dates.ts) and applies with milestoneStatus()
-- (src/lib/milestones/status.ts). Computing it here with now() would give the date a second
-- source and make the midnight and DST boundaries untestable.
create view public.milestone_balances
with (security_invoker = true)
as
select
  m.id,
  m.project_id,
  m.description,
  m.amount,
  m.due_date,
  m.sort_order,
  m.cancelled_at,
  0::bigint as paid,
  m.amount as balance
from public.milestones as m;

comment on view public.milestone_balances is
  'Milestones with paid and balance in agorot (SPEC 6). M1.3: paid = 0 until incomes (M2).';

revoke all on table public.milestone_balances from public, anon, authenticated;
grant select on table public.milestone_balances to authenticated, service_role;

-- MS-1: moves a milestone one place up or down by swapping places with its nearest
-- neighbour in the same project. Returns 'moved', 'edge' (already first or last; nothing
-- changes) or 'not_found' (no such milestone, or not visible under RLS). SECURITY INVOKER.
create function public.move_milestone(p_milestone_id uuid, p_direction text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_project_id uuid;
  target_place integer;
  neighbour_id uuid;
  neighbour_place integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception using errcode = '22023', message = 'p_direction must be up or down.';
  end if;

  select m.project_id into target_project_id from public.milestones as m where m.id = p_milestone_id;
  if target_project_id is null then
    return 'not_found';
  end if;

  -- One writer of this project's order at a time (inserts take the same lock).
  perform 1 from public.projects as p where p.id = target_project_id for no key update;

  -- Read the place only after the lock: a concurrent move may have just changed it. Each
  -- statement of a READ COMMITTED transaction sees what was committed before it started.
  select m.sort_order into target_place from public.milestones as m where m.id = p_milestone_id;
  if target_place is null then
    return 'not_found';
  end if;

  if p_direction = 'up' then
    select m.id, m.sort_order into neighbour_id, neighbour_place
    from public.milestones as m
    where m.project_id = target_project_id and m.sort_order < target_place
    order by m.sort_order desc
    limit 1;
  else
    select m.id, m.sort_order into neighbour_id, neighbour_place
    from public.milestones as m
    where m.project_id = target_project_id and m.sort_order > target_place
    order by m.sort_order
    limit 1;
  end if;

  if neighbour_id is null then
    return 'edge';
  end if;

  update public.milestones as m
  set sort_order = case when m.id = p_milestone_id then neighbour_place else target_place end
  where m.id in (p_milestone_id, neighbour_id);
  return 'moved';
end;
$$;

comment on function public.move_milestone(uuid, text) is
  'MS-1: swaps a milestone with its neighbour above or below, under a per-project lock.';

-- MS-6: one page of open debts: milestones that are not cancelled, have a balance and whose
-- due date is before p_today (today in Asia/Jerusalem, passed by the app so there is one
-- source of "today"). Oldest due date first. Owner decision (M1.3): the project's status and
-- archive state do not filter the list. Pages hold at most 100 rows. SECURITY INVOKER.
create function public.list_open_debts(
  p_today date,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  description text,
  due_date date,
  balance bigint,
  project_id uuid,
  project_name text,
  project_archived boolean,
  client_id uuid,
  client_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    b.id,
    b.description,
    b.due_date,
    b.balance,
    p.id,
    p.name,
    p.archived_at is not null,
    c.id,
    c.name
  from public.milestone_balances as b
  join public.projects as p on p.id = b.project_id
  join public.clients as c on c.id = p.client_id
  where b.cancelled_at is null
    and b.balance > 0
    and b.due_date < p_today
  order by b.due_date, b.project_id, b.sort_order, b.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.list_open_debts(date, integer, integer) is
  'MS-6: bounded page of overdue, unpaid, non-cancelled milestones, oldest first.';

-- MS-6: the number of open debts and the sum of their balances (agorot), same filter as
-- list_open_debts.
create function public.open_debts_summary(p_today date)
returns table (debt_count bigint, total_balance bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), coalesce(sum(b.balance), 0)::bigint
  from public.milestone_balances as b
  where b.cancelled_at is null
    and b.balance > 0
    and b.due_date < p_today;
$$;

comment on function public.open_debts_summary(date) is
  'MS-6: count and total balance of the open debts.';

-- Supabase grants EXECUTE on new public functions to anon by default; only signed-in users
-- may call these (RLS then limits rows to allowlisted users).
revoke execute on function public.move_milestone(uuid, text) from public, anon;
revoke execute on function public.list_open_debts(date, integer, integer) from public, anon;
revoke execute on function public.open_debts_summary(date) from public, anon;
grant execute on function public.move_milestone(uuid, text) to authenticated, service_role;
grant execute on function public.list_open_debts(date, integer, integer)
  to authenticated, service_role;
grant execute on function public.open_debts_summary(date) to authenticated, service_role;
