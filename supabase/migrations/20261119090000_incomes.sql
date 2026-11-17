-- M2.1: incomes, recording milestone payments and the audit log (SPEC sections 5.2 CLI-4,
-- 5.3 PRJ-3, 5.4 MS-2/MS-4/MS-5, 5.5 INC-1/INC-2/INC-5/INC-6 and 6).
--
-- Financial records are never deleted physically (SPEC 6): an income is soft-deleted by
-- setting deleted_at, users have no DELETE privilege, and every insert, update and soft
-- delete is written to audit_log by a trigger.
--
-- Consistency (criterion 1) is enforced here, for every writer: an income's milestone must
-- belong to its project, and its project to its client. The triggers lock the referenced
-- rows (FOR SHARE) until the transaction ends, so a project cannot move to another client,
-- and a milestone cannot be cancelled, between the check and the write. Locks are always
-- taken project first, then milestone, the order move_milestone() and the milestone insert
-- trigger use, so these writers cannot deadlock each other.

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  client_id uuid not null references public.clients (id) on delete restrict,
  project_id uuid references public.projects (id) on delete restrict,
  milestone_id uuid references public.milestones (id) on delete restrict,
  received_date date not null,
  amount bigint not null,
  payment_method text not null,
  notes text,
  deleted_at timestamptz,
  -- Owner decision (M2.1): more than 0, at most ₪99,999,999.99 (MAX_AGOROT).
  constraint incomes_amount_check check (amount between 1 and 9999999999),
  constraint incomes_received_date_check check (
    received_date between '1900-01-01' and '2100-12-31'
  ),
  -- INC-5. Mirrors src/lib/incomes/payment-methods.ts.
  constraint incomes_payment_method_check check (
    payment_method in ('bank_transfer', 'bit_paybox', 'cash', 'check', 'credit_card', 'other')
  ),
  constraint incomes_notes_check check (notes = btrim(notes) and char_length(notes) between 1 and 2000),
  -- A milestone always comes with its project (the trigger below checks they match).
  constraint incomes_milestone_needs_project_check check (
    milestone_id is null or project_id is not null
  )
);

comment on table public.incomes is
  'Incomes (SPEC 5.5). One payment = one income (INC-6). deleted_at set = soft-deleted (SPEC 6).';
comment on column public.incomes.amount is 'Amount in agorot (integer), more than 0.';

-- The incomes list (INC-1): newest received date first, optionally for one client.
create index incomes_received_date_idx on public.incomes (received_date desc, id)
  where deleted_at is null;
-- Foreign keys (SPEC 6).
create index incomes_client_id_idx on public.incomes (client_id, received_date desc);
create index incomes_project_id_idx on public.incomes (project_id);
create index incomes_milestone_id_idx on public.incomes (milestone_id);
create index incomes_created_by_idx on public.incomes (created_by);

create trigger incomes_set_updated_at
before update on public.incomes
for each row execute function public.set_updated_at();

-- Consistency and owner decisions, raised with their own SQLSTATEs so the app can show its
-- own messages:
-- HKI01: the milestone is not the project's, or the project is not the client's.
-- HKI02: owner decision (M2.1): no payment for a cancelled milestone. Checked when the
--        milestone is set (a new income, or another milestone); an income recorded before
--        the milestone was cancelled stays editable.
-- HKI03: owner decision (M2.1): the received date is not in the future (Asia/Jerusalem).
--        Checked when the date is set, so an existing income keeps its date.
create function public.incomes_check_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  milestone_project_id uuid;
  milestone_cancelled_at timestamptz;
  project_client_id uuid;
begin
  if tg_op = 'INSERT' or new.received_date is distinct from old.received_date then
    if new.received_date > (pg_catalog.now() at time zone 'Asia/Jerusalem')::date then
      raise exception using
        errcode = 'HKI03',
        message = 'The received date is in the future.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and new.client_id is not distinct from old.client_id
    and new.project_id is not distinct from old.project_id
    and new.milestone_id is not distinct from old.milestone_id then
    return new;
  end if;

  if new.project_id is not null then
    -- Project first (lock order). A missing or invisible project is left to the foreign key
    -- and RLS checks.
    select p.client_id into project_client_id
    from public.projects as p
    where p.id = new.project_id
    for share;
    if found and project_client_id is distinct from new.client_id then
      raise exception using
        errcode = 'HKI01',
        message = 'The project does not belong to the income''s client.';
    end if;
  end if;

  if new.milestone_id is not null then
    select m.project_id, m.cancelled_at into milestone_project_id, milestone_cancelled_at
    from public.milestones as m
    where m.id = new.milestone_id
    for share;
    if found then
      if milestone_project_id is distinct from new.project_id then
        raise exception using
          errcode = 'HKI01',
          message = 'The milestone does not belong to the income''s project.';
      end if;
      if milestone_cancelled_at is not null
        and (tg_op = 'INSERT' or new.milestone_id is distinct from old.milestone_id) then
        raise exception using
          errcode = 'HKI02',
          message = 'The milestone is cancelled; no payment can be recorded for it.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.incomes_check_references() from public, anon, authenticated;

create trigger incomes_check_references
before insert or update of received_date, client_id, project_id, milestone_id on public.incomes
for each row execute function public.incomes_check_references();

-- A project whose incomes name its client cannot move to another client (HKI04), or the
-- incomes would disagree with it. The UPDATE has already locked the project row, so no
-- income for it can be inserted until this transaction ends (the income trigger takes FOR
-- SHARE on the project), and every income committed before is visible to this check.
-- Milestones never move to another project: authenticated has no UPDATE on project_id.
create function public.projects_keep_income_clients()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.incomes as i
    where i.project_id = new.id
      and i.client_id is distinct from new.client_id
  ) then
    raise exception using
      errcode = 'HKI04',
      message = 'The project has incomes of its client; it cannot move to another client.';
  end if;
  return new;
end;
$$;

revoke execute on function public.projects_keep_income_clients() from public, anon, authenticated;

create trigger projects_keep_income_clients
before update of client_id on public.projects
for each row
when (new.client_id is distinct from old.client_id)
execute function public.projects_keep_income_clients();

-- Row Level Security: allowlisted users (owner and admin) read and write; anon has nothing.
-- No DELETE privilege at all (SPEC 6). A soft-deleted income can no longer be changed: the
-- UPDATE policy only reaches rows that are not deleted.
alter table public.incomes enable row level security;

revoke all on table public.incomes from public, anon, authenticated;
grant select on table public.incomes to authenticated;
-- Column privileges: id, created_at, created_by and updated_at are set by the database.
grant insert (client_id, project_id, milestone_id, received_date, amount, payment_method, notes)
  on table public.incomes to authenticated;
grant update (
  client_id, project_id, milestone_id, received_date, amount, payment_method, notes, deleted_at
) on table public.incomes to authenticated;
grant all on table public.incomes to service_role;

create policy incomes_select_allowed
on public.incomes
for select
to authenticated
using ((select public.is_allowed_user()));

create policy incomes_insert_allowed
on public.incomes
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy incomes_update_allowed
on public.incomes
for update
to authenticated
using ((select public.is_allowed_user()) and deleted_at is null)
with check ((select public.is_allowed_user()));

-- Audit log (SPEC 6, criterion 2). Written only by trigger functions that run as their
-- owner (SECURITY DEFINER, fixed empty search_path); users can read it if allowlisted and
-- can never write it. actor is the signed-in user (auth.uid()); it has no foreign key, so
-- the record of who did what survives the user's deletion unchanged.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor uuid,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  diff jsonb not null,
  constraint audit_log_action_check check (action in ('insert', 'update', 'delete'))
);

comment on table public.audit_log is
  'Who changed which financial record and how (SPEC 6). Written by triggers only.';
comment on column public.audit_log.diff is
  'Changed fields only: {"field": {"old": ..., "new": ...}}; free text is recorded as {"changed": true}.';

create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at);
create index audit_log_created_at_idx on public.audit_log (created_at);

alter table public.audit_log enable row level security;

revoke all on table public.audit_log from public, anon, authenticated;
grant select on table public.audit_log to authenticated;
grant all on table public.audit_log to service_role;

create policy audit_log_select_allowed
on public.audit_log
for select
to authenticated
using ((select public.is_allowed_user()));

-- The income fields an audit diff may hold, and nothing else. Notes are free text that may
-- name people, so only the fact that they changed is recorded (no personal data in logs,
-- SPEC 8). An insert lists the fields that were set; a soft delete is the action 'delete'.
create function public.audit_incomes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else '{}'::jsonb end;
  new_row jsonb := pg_catalog.to_jsonb(new);
  field text;
  diff jsonb := '{}'::jsonb;
  audit_action text;
begin
  foreach field in array array[
    'client_id', 'project_id', 'milestone_id', 'received_date', 'amount', 'payment_method',
    'notes', 'deleted_at'
  ] loop
    if (old_row -> field) is distinct from (new_row -> field)
      and not (tg_op = 'INSERT' and new_row -> field = 'null'::jsonb) then
      if field = 'notes' then
        diff := diff || pg_catalog.jsonb_build_object(field, '{"changed": true}'::jsonb);
      elsif tg_op = 'INSERT' then
        diff := diff || pg_catalog.jsonb_build_object(
          field, pg_catalog.jsonb_build_object('new', new_row -> field)
        );
      else
        diff := diff || pg_catalog.jsonb_build_object(
          field,
          pg_catalog.jsonb_build_object('old', old_row -> field, 'new', new_row -> field)
        );
      end if;
    end if;
  end loop;

  if diff = '{}'::jsonb then
    return null;
  end if;
  audit_action := case
    when tg_op = 'INSERT' then 'insert'
    when old.deleted_at is null and new.deleted_at is not null then 'delete'
    else 'update'
  end;
  insert into public.audit_log (actor, entity, entity_id, action, diff)
  values (auth.uid(), 'incomes', new.id, audit_action, diff);
  return null;
end;
$$;

revoke execute on function public.audit_incomes() from public, anon, authenticated;

create trigger incomes_audit
after insert or update on public.incomes
for each row execute function public.audit_incomes();

-- MS-2: paid is now the sum of the milestone's incomes that are not deleted, and the
-- balance is amount − paid. The balance is negative when a milestone was overpaid (MS-5
-- allows it after confirmation). Same columns as before, so every reader keeps working.
create or replace view public.milestone_balances
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
  coalesce(payments.paid, 0)::bigint as paid,
  (m.amount - coalesce(payments.paid, 0))::bigint as balance
from public.milestones as m
left join lateral (
  select sum(i.amount) as paid
  from public.incomes as i
  where i.milestone_id = m.id
    and i.deleted_at is null
) as payments on true;

comment on view public.milestone_balances is
  'Milestones with paid (non-deleted incomes) and balance = amount − paid, in agorot (SPEC 6).';

-- MS-4 / MS-5 / INC-1: records a new income (p_income_id null) or saves changes to one.
-- With a milestone, the milestone's balance is read under a lock that serializes the
-- payments of that milestone, so two payments recorded at once cannot both see the old
-- balance. A payment above that balance is not saved: the result is 'needs_confirmation'
-- with the balance, and the caller saves it by calling again with p_confirmed_balance set
-- to that balance. If the balance changed in between (another payment, an edit), the
-- confirmation no longer matches and the caller is asked again.
-- Results: 'saved' (with the income's id), 'needs_confirmation' (with the balance) and
-- 'not_found' (the income to edit does not exist, is deleted or is not visible). The
-- triggers' errors (HKI01..HKI03), check violations and foreign key violations are raised.
-- SECURITY INVOKER: privileges and RLS apply as for direct writes.
create function public.save_income(
  p_income_id uuid,
  p_client_id uuid,
  p_project_id uuid,
  p_milestone_id uuid,
  p_received_date date,
  p_amount bigint,
  p_payment_method text,
  p_notes text,
  p_confirmed_balance bigint default null
)
returns table (result text, income_id uuid, balance bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  milestone_project_id uuid;
  milestone_amount bigint;
  milestone_cancelled_at timestamptz;
  previous_milestone_id uuid;
  current_balance bigint;
  saved_id uuid;
begin
  if p_income_id is not null then
    select i.milestone_id into previous_milestone_id
    from public.incomes as i
    where i.id = p_income_id and i.deleted_at is null;
    if not found then
      return query select 'not_found'::text, null::uuid, null::bigint;
      return;
    end if;
  end if;

  if p_milestone_id is not null then
    select m.project_id into milestone_project_id
    from public.milestones as m
    where m.id = p_milestone_id;
    if found then
      -- Project first, then the milestone (see the lock order at the top).
      perform 1 from public.projects as p where p.id = milestone_project_id for share;
      select m.amount, m.cancelled_at into milestone_amount, milestone_cancelled_at
      from public.milestones as m
      where m.id = p_milestone_id
      for no key update;
      if milestone_cancelled_at is not null
        and p_milestone_id is distinct from previous_milestone_id then
        raise exception using
          errcode = 'HKI02',
          message = 'The milestone is cancelled; no payment can be recorded for it.';
      end if;
      select milestone_amount - coalesce(sum(i.amount), 0)
      into current_balance
      from public.incomes as i
      where i.milestone_id = p_milestone_id
        and i.deleted_at is null
        and i.id is distinct from p_income_id;
      if p_amount > current_balance
        and p_confirmed_balance is distinct from current_balance then
        return query select 'needs_confirmation'::text, null::uuid, current_balance;
        return;
      end if;
    end if;
  end if;

  if p_income_id is null then
    insert into public.incomes (
      client_id, project_id, milestone_id, received_date, amount, payment_method, notes
    )
    values (
      p_client_id, p_project_id, p_milestone_id, p_received_date, p_amount, p_payment_method,
      p_notes
    )
    returning id into saved_id;
  else
    update public.incomes as i
    set
      client_id = p_client_id,
      project_id = p_project_id,
      milestone_id = p_milestone_id,
      received_date = p_received_date,
      amount = p_amount,
      payment_method = p_payment_method,
      notes = p_notes
    where i.id = p_income_id and i.deleted_at is null
    returning i.id into saved_id;
    if saved_id is null then
      return query select 'not_found'::text, null::uuid, null::bigint;
      return;
    end if;
  end if;
  return query select 'saved'::text, saved_id, current_balance;
end;
$$;

comment on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint) is
  'MS-4/MS-5/INC-1: records or edits an income; a payment above the milestone balance needs a matching confirmation.';

-- INC-1: one page of incomes that are not deleted, received in the month starting at
-- p_month (its first day), optionally of one client; newest received date first, then the
-- newest recorded. Pages hold at most 100 rows. SECURITY INVOKER.
create function public.list_incomes(
  p_month date,
  p_client_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  received_date date,
  amount bigint,
  payment_method text,
  client_id uuid,
  client_name text,
  project_id uuid,
  project_name text,
  milestone_id uuid,
  milestone_description text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.received_date,
    i.amount,
    i.payment_method,
    c.id,
    c.name,
    p.id,
    p.name,
    m.id,
    m.description
  from public.incomes as i
  join public.clients as c on c.id = i.client_id
  left join public.projects as p on p.id = i.project_id
  left join public.milestones as m on m.id = i.milestone_id
  where i.deleted_at is null
    and i.received_date >= p_month
    and i.received_date < (p_month + interval '1 month')::date
    and (p_client_id is null or i.client_id = p_client_id)
  order by i.received_date desc, i.created_at desc, i.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.list_incomes(date, uuid, integer, integer) is
  'INC-1: bounded page of a month''s incomes, optionally of one client, newest first.';

-- INC-1: the number and the total (agorot) of the same month's incomes.
create function public.incomes_month_summary(p_month date, p_client_id uuid default null)
returns table (income_count bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), coalesce(sum(i.amount), 0)::bigint
  from public.incomes as i
  where i.deleted_at is null
    and i.received_date >= p_month
    and i.received_date < (p_month + interval '1 month')::date
    and (p_client_id is null or i.client_id = p_client_id);
$$;

comment on function public.incomes_month_summary(date, uuid) is
  'INC-1: count and total of a month''s incomes, optionally of one client.';

-- PRJ-3: the total of a project's incomes that are not deleted (agorot), with or without a
-- milestone.
create function public.project_paid_total(p_project_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(i.amount), 0)::bigint
  from public.incomes as i
  where i.project_id = p_project_id
    and i.deleted_at is null;
$$;

comment on function public.project_paid_total(uuid) is
  'PRJ-3: total of the project''s incomes that are not deleted.';

-- CLI-4: what a client paid (all incomes that are not deleted, with or without a project)
-- and the open balance: the sum of the positive balances of the non-cancelled milestones of
-- the client's projects that are not archived. An overpaid milestone does not reduce the
-- balance of another one.
create function public.client_payment_summary(p_client_id uuid)
returns table (total_paid bigint, open_balance bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (
      select coalesce(sum(i.amount), 0)::bigint
      from public.incomes as i
      where i.client_id = p_client_id
        and i.deleted_at is null
    ),
    (
      select coalesce(sum(b.balance), 0)::bigint
      from public.milestone_balances as b
      join public.projects as p on p.id = b.project_id
      where p.client_id = p_client_id
        and p.archived_at is null
        and b.cancelled_at is null
        and b.balance > 0
    );
$$;

comment on function public.client_payment_summary(uuid) is
  'CLI-4: total paid by the client and the open balance of its non-archived projects.';

-- Supabase grants EXECUTE on new public functions to anon by default; only signed-in users
-- may call these (RLS then limits rows to allowlisted users).
revoke execute on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint)
  from public, anon;
revoke execute on function public.list_incomes(date, uuid, integer, integer) from public, anon;
revoke execute on function public.incomes_month_summary(date, uuid) from public, anon;
revoke execute on function public.project_paid_total(uuid) from public, anon;
revoke execute on function public.client_payment_summary(uuid) from public, anon;
grant execute on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint)
  to authenticated, service_role;
grant execute on function public.list_incomes(date, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.incomes_month_summary(date, uuid) to authenticated, service_role;
grant execute on function public.project_paid_total(uuid) to authenticated, service_role;
grant execute on function public.client_payment_summary(uuid) to authenticated, service_role;
