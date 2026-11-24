-- M7.1 hardening.
--
-- 1. Idempotent create (M7.1-8). Every create form sends a key generated with the page
--    (create_key). A request whose answer was lost and that is sent again carries the same
--    key; the unique constraint stops it from creating a second row, and the app then answers
--    with the row the first request created. NULL (no key) never conflicts: a plain UNIQUE
--    constraint treats NULLs as distinct. Edits never change the key (no UPDATE grant).
-- 2. A file an expense ever recorded cannot be recorded by another expense (M7.1-9, HKE04).

alter table public.clients add column create_key uuid;
alter table public.clients add constraint clients_create_key_key unique (create_key);
grant insert (create_key) on table public.clients to authenticated;

alter table public.projects add column create_key uuid;
alter table public.projects add constraint projects_create_key_key unique (create_key);
grant insert (create_key) on table public.projects to authenticated;

alter table public.milestones add column create_key uuid;
alter table public.milestones add constraint milestones_create_key_key unique (create_key);
grant insert (create_key) on table public.milestones to authenticated;

alter table public.incomes add column create_key uuid;
alter table public.incomes add constraint incomes_create_key_key unique (create_key);
grant insert (create_key) on table public.incomes to authenticated;

alter table public.expenses add column create_key uuid;
alter table public.expenses add constraint expenses_create_key_key unique (create_key);
grant insert (create_key) on table public.expenses to authenticated;

alter table public.tasks add column create_key uuid;
alter table public.tasks add constraint tasks_create_key_key unique (create_key);
grant insert (create_key) on table public.tasks to authenticated;

comment on column public.clients.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';
comment on column public.projects.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';
comment on column public.milestones.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';
comment on column public.incomes.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';
comment on column public.expenses.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';
comment on column public.tasks.create_key is 'M7.1: key of the create form; a repeated submit does not create a second row.';

-- save_income gains p_create_key (last, default null, so existing named calls keep working).
-- A new income whose key was already used answers 'saved' with the income that key created
-- (also when a concurrent request with the same key commits first: ON CONFLICT waits for it).
-- The body is otherwise unchanged from 20261119090000_incomes.sql.
drop function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint);

create function public.save_income(
  p_income_id uuid,
  p_client_id uuid,
  p_project_id uuid,
  p_milestone_id uuid,
  p_received_date date,
  p_amount bigint,
  p_payment_method text,
  p_notes text,
  p_confirmed_balance bigint default null,
  p_create_key uuid default null
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
  if p_income_id is null and p_create_key is not null then
    select i.id into saved_id from public.incomes as i where i.create_key = p_create_key;
    if found then
      return query select 'saved'::text, saved_id, null::bigint;
      return;
    end if;
  end if;

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
      -- Project first, then the milestone (see the lock order in the incomes migration).
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
      client_id, project_id, milestone_id, received_date, amount, payment_method, notes,
      create_key
    )
    values (
      p_client_id, p_project_id, p_milestone_id, p_received_date, p_amount, p_payment_method,
      p_notes, p_create_key
    )
    on conflict (create_key) do nothing
    returning id into saved_id;
    if saved_id is null then
      -- A concurrent request with the same key committed first.
      select i.id into saved_id from public.incomes as i where i.create_key = p_create_key;
    end if;
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

comment on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint, uuid) is
  'MS-4/MS-5/INC-1: records or edits an income; a payment above the milestone balance needs a matching confirmation; M7.1: a repeated create key returns the income it created.';

revoke execute on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint, uuid)
  from public, anon;
grant execute on function public.save_income(uuid, uuid, uuid, uuid, date, bigint, text, text, bigint, uuid)
  to authenticated, service_role;

-- M7.1-9 (HKE04): a path in recorded_expense_files belongs to the expense that recorded it.
-- The unique constraint on expenses.file_path only covers current files; a file an expense
-- replaced (kept in storage, still recorded) could otherwise be attached to another expense.
-- The same expense may attach its own earlier file again, and a repeated create (same key)
-- reaches the unique constraints, so the app answers with the first expense. SECURITY DEFINER: the table is not
-- readable by the caller.
create function public.expenses_check_file_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.file_path is not null
    and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path)
    and exists (
      select 1
      from public.recorded_expense_files as r
      where r.path = new.file_path
        and r.expense_id is distinct from new.id
        -- The same create sent again (M7.1-8) is left to the unique constraints.
        and not exists (
          select 1
          from public.expenses as e
          where e.id = r.expense_id and e.create_key = new.create_key
        )
    ) then
    raise exception using
      errcode = 'HKE04',
      message = 'The file was recorded by another expense.';
  end if;
  return new;
end;
$$;

revoke execute on function public.expenses_check_file_owner() from public, anon, authenticated;

create trigger expenses_check_file_owner
before insert or update of file_path on public.expenses
for each row execute function public.expenses_check_file_owner();
