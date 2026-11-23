-- M6: tasks and in-app reminders (SPEC sections 3, 5.8 CAL-11, 5.9 DASH-5, 5.12 TASK-1..10,
-- 5.13 NOTIF-1..3 and 6).
--
-- * A task has a title, an optional description, an optional due date (a calendar date, no
--   time: TASK-1/2), a priority (high / normal / low, default normal) and a status (open /
--   done / cancelled, TASK-3). It may name a client, and a project of that client (TASK-9).
--   There is no assignee (TASK-5).
-- * "Overdue" is computed, never stored (TASK-3): an open task whose due date is before today
--   in Asia/Jerusalem. "Today" is passed by the app (todayInJerusalem()), as for open debts,
--   so there is one source of the date and the midnight and DST boundaries are testable.
-- * completed_at is set by the database when a task becomes done and cleared when it stops
--   being done (TASK-4); users cannot write it.
-- * Tasks are never deleted physically (TASK-10): deleted_at is a soft delete, stamped by the
--   database, and users have no DELETE privilege. Archiving a client or a project changes
--   nothing on its tasks (TASK-10). A client or project with tasks cannot be deleted (ON
--   DELETE RESTRICT), only archived.
-- * TASK-9 is enforced here for every writer: a task's project must belong to its client, and
--   a project needs its client. When a project moves to another client, its tasks move with it.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  title text not null,
  description text,
  due_date date,
  priority text not null default 'normal',
  status text not null default 'open',
  client_id uuid references public.clients (id) on delete restrict,
  project_id uuid references public.projects (id) on delete restrict,
  completed_at timestamptz,
  deleted_at timestamptz,
  -- 1 = high, 2 = normal, 3 = low: lists sort by due date and then by this (TASK-6).
  priority_rank smallint generated always as (
    case priority when 'high' then 1 when 'normal' then 2 else 3 end
  ) stored,
  -- Mirrors the shared zod schema (src/lib/tasks/schema.ts).
  constraint tasks_title_check check (title = btrim(title) and char_length(title) between 1 and 200),
  constraint tasks_description_check check (
    description = btrim(description) and char_length(description) between 1 and 2000
  ),
  constraint tasks_due_date_check check (due_date between '1900-01-01' and '2100-12-31'),
  constraint tasks_priority_check check (priority in ('high', 'normal', 'low')),
  constraint tasks_status_check check (status in ('open', 'done', 'cancelled')),
  -- TASK-9: a project always comes with its client (the trigger below checks they match).
  constraint tasks_project_needs_client_check check (project_id is null or client_id is not null),
  constraint tasks_completed_at_check check (completed_at is null or status = 'done')
);

comment on table public.tasks is
  'Tasks (SPEC 5.12). Overdue is computed (TASK-3). deleted_at set = soft-deleted (TASK-10).';
comment on column public.tasks.completed_at is
  'When the task became done (TASK-4); set and cleared by the database.';

-- The open list, the calendar, the badge and the dashboard card read open tasks by due date.
create index tasks_open_due_date_idx on public.tasks (due_date, priority_rank, created_at)
  where status = 'open' and deleted_at is null;
-- The "done / cancelled" tab: most recently closed first.
create index tasks_closed_idx on public.tasks (updated_at desc, id)
  where status <> 'open' and deleted_at is null;
-- Foreign keys (SPEC 6); also the tasks sections of the client and project cards (TASK-8).
create index tasks_client_id_idx on public.tasks (client_id);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_created_by_idx on public.tasks (created_by);

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

-- TASK-4 / TASK-10: completed_at follows the status, and the time of a soft delete comes from
-- the database. A task that stays done keeps its completed_at.
create function public.tasks_stamp_times()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := pg_catalog.now();
    else
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;

  if tg_op = 'INSERT' then
    new.deleted_at := null;
  elsif old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := pg_catalog.now();
  elsif old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_stamp_times() from public, anon, authenticated;

create trigger tasks_stamp_times
before insert or update on public.tasks
for each row execute function public.tasks_stamp_times();

-- TASK-9: the project must belong to the task's client. Raised as HKT01 so the app can show
-- its own message. FOR SHARE locks the project row until the transaction ends, so the project
-- cannot move to another client between this check and the write (the move takes the row
-- lock first and then moves the project's tasks, see below).
create function public.tasks_check_references()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  project_client_id uuid;
begin
  if tg_op = 'UPDATE'
    and new.client_id is not distinct from old.client_id
    and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  if new.project_id is not null then
    -- A missing or invisible project is left to the foreign key and RLS checks.
    select p.client_id into project_client_id
    from public.projects as p
    where p.id = new.project_id
    for share;
    if found and project_client_id is distinct from new.client_id then
      raise exception using
        errcode = 'HKT01',
        message = 'The project does not belong to the task''s client.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_check_references() from public, anon, authenticated;

create trigger tasks_check_references
before insert or update of client_id, project_id on public.tasks
for each row execute function public.tasks_check_references();

-- TASK-9: a project that moves to another client takes its tasks along (deleted ones too, so
-- no row ever disagrees with its project). Runs after the project row is updated and locked:
-- a task written for the project meanwhile waits for this transaction and then sees the new
-- client. SECURITY DEFINER because users cannot update deleted tasks (see the policy below);
-- it changes nothing but client_id of the moved project's tasks.
create function public.projects_move_task_clients()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tasks as t
  set client_id = new.client_id
  where t.project_id = new.id
    and t.client_id is distinct from new.client_id;
  return null;
end;
$$;

revoke execute on function public.projects_move_task_clients() from public, anon, authenticated;

create trigger projects_move_task_clients
after update of client_id on public.projects
for each row
when (new.client_id is distinct from old.client_id)
execute function public.projects_move_task_clients();

-- Row Level Security: allowlisted users (owner and admin) read and write (TASK-5); anon has
-- nothing. No DELETE privilege (TASK-10). A soft-deleted task can no longer be changed: the
-- UPDATE policy only reaches rows that are not deleted.
alter table public.tasks enable row level security;

revoke all on table public.tasks from public, anon, authenticated;
grant select on table public.tasks to authenticated;
-- Column privileges: id, created_*, updated_at, completed_at and priority_rank are set by the
-- database.
grant insert (title, description, due_date, priority, status, client_id, project_id)
  on table public.tasks to authenticated;
grant update (title, description, due_date, priority, status, client_id, project_id, deleted_at)
  on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

create policy tasks_select_allowed
on public.tasks
for select
to authenticated
using ((select public.is_allowed_user()));

create policy tasks_insert_allowed
on public.tasks
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy tasks_update_allowed
on public.tasks
for update
to authenticated
using ((select public.is_allowed_user()) and deleted_at is null)
with check ((select public.is_allowed_user()));

-- TASK-4: marks a task done (p_done true) or open again, in one step under the row lock, so a
-- double tap, two tabs or both users at once cannot flip it back and forth by accident: the
-- caller says which state it wants, not "toggle". Results: 'changed', 'unchanged' (it already
-- was in that state), 'cancelled' (a cancelled task is reopened only from its edit form) and
-- 'not_found' (no such task, deleted, or not visible). SECURITY INVOKER: privileges and RLS
-- apply as for a direct update.
create function public.set_task_done(p_task_id uuid, p_done boolean)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
begin
  if p_done is null then
    raise exception using errcode = '22023', message = 'p_done must not be null.';
  end if;
  select t.status into current_status
  from public.tasks as t
  where t.id = p_task_id and t.deleted_at is null
  for no key update;
  if not found then
    return 'not_found';
  end if;
  if current_status = 'cancelled' then
    return 'cancelled';
  end if;
  if (current_status = 'done') = p_done then
    return 'unchanged';
  end if;
  update public.tasks as t
  set status = case when p_done then 'done' else 'open' end
  where t.id = p_task_id;
  return 'changed';
end;
$$;

comment on function public.set_task_done(uuid, boolean) is
  'TASK-4: marks a task done or open again under the row lock; idempotent.';

-- NOTIF-1 / NOTIF-2 / DASH-5: the number of open tasks that are overdue, due today and due
-- tomorrow, where p_today is today in Asia/Jerusalem (passed by the app, NOTIF-3: computed on
-- load from the data). Tasks without a due date never count (TASK-2).
create function public.task_reminder_counts(p_today date)
returns table (overdue bigint, due_today bigint, due_tomorrow bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where t.due_date < p_today),
    count(*) filter (where t.due_date = p_today),
    count(*) filter (where t.due_date = p_today + 1)
  from public.tasks as t
  where t.status = 'open'
    and t.deleted_at is null
    and t.due_date <= p_today + 1;
$$;

comment on function public.task_reminder_counts(date) is
  'NOTIF-1/2: counts of open tasks overdue, due today and due tomorrow.';

-- TASK-7: the clients and the projects that tasks name (tasks that are not deleted), for the
-- list's filters, by name. Bounded to 501 rows each, so the caller can tell more exist.
create function public.task_filter_clients()
returns table (id uuid, name text, archived boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct c.id, c.name, c.archived_at is not null
  from public.tasks as t
  join public.clients as c on c.id = t.client_id
  where t.deleted_at is null
  order by c.name, c.id
  limit 501;
$$;

create function public.task_filter_projects()
returns table (id uuid, name text, client_id uuid, archived boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct p.id, p.name, p.client_id, p.archived_at is not null
  from public.tasks as t
  join public.projects as p on p.id = t.project_id
  where t.deleted_at is null
  order by p.name, p.id
  limit 501;
$$;

comment on function public.task_filter_clients() is 'TASK-7: clients named by tasks, by name.';
comment on function public.task_filter_projects() is 'TASK-7: projects named by tasks, by name.';

revoke execute on function public.task_filter_clients() from public, anon;
revoke execute on function public.task_filter_projects() from public, anon;
grant execute on function public.task_filter_clients() to authenticated, service_role;
grant execute on function public.task_filter_projects() to authenticated, service_role;
revoke execute on function public.set_task_done(uuid, boolean) from public, anon;
revoke execute on function public.task_reminder_counts(date) from public, anon;
grant execute on function public.set_task_done(uuid, boolean) to authenticated, service_role;
grant execute on function public.task_reminder_counts(date) to authenticated, service_role;
