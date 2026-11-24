-- M7.2: Web Push (SPEC 5.13 NOTIF-4..16, 6, 7; docs/specs/m7-2-push.md).
--
-- * push_subscriptions: one row per browser that turned notifications on (NOTIF-5). A user
--   sees and deletes only their own rows; rows are written by save_push_subscription().
-- * reminder_runs: one row per local date (Asia/Jerusalem) of the daily job; the unique
--   run_date makes a second run or a retry on the same date send nothing (NOTIF-9).
-- * pg_cron runs invoke_daily_reminders() at 06:00 and 07:00 UTC (NOTIF-16); it POSTs to the
--   Edge Function `push` through pg_net with a shared secret. The function sends only when the
--   local hour is 9. The secret is generated here and kept in Vault (never in the repository);
--   the function URL differs per project and is set by configure_push_reminders() (the
--   migrations workflows call it, docs/setup/push.md).

-- VERIFY-04 / NOTIF-16: without pg_cron and pg_net the schedule cannot exist. Fail the
-- migration with a clear message instead of creating half of it (SPEC 13: stop and escalate;
-- the fallback would be a Netlify Scheduled Function).
do $$
declare
  missing text[];
begin
  select array_agg(required.name order by required.name) into missing
  from (values ('pg_cron'), ('pg_net'), ('supabase_vault')) as required (name)
  where not exists (
    select 1 from pg_catalog.pg_available_extensions as e where e.name = required.name
  );
  if missing is not null then
    raise exception 'M7.2 push: required extension(s) not available on this database: %', missing
      using hint = 'VERIFY-04: pg_cron/pg_net must be available (Supabase Integrations -> Cron). Stop and escalate to the owner.';
  end if;
end;
$$;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Push services the app accepts (Chrome: FCM; the others are listed so another browser fails
-- only on SPEC's "Chrome only", not on a cryptic error). The Edge Function POSTs only here.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  -- Mirrors src/lib/push/schema.ts.
  constraint push_subscriptions_endpoint_check check (
    char_length(endpoint) <= 2048
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)/[!-~]+$'
  ),
  -- base64url without padding: a 65-byte uncompressed P-256 point (starts with 0x04) and a
  -- 16-byte secret.
  constraint push_subscriptions_p256dh_check check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  constraint push_subscriptions_auth_check check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_user_agent_check check (char_length(user_agent) <= 300)
);

comment on table public.push_subscriptions is
  'NOTIF-5: Web Push subscriptions, one per device that turned notifications on.';

create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index push_subscriptions_created_by_idx on public.push_subscriptions (created_by);

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

create policy push_subscriptions_delete_own
on public.push_subscriptions
for delete
to authenticated
using (user_id = (select auth.uid()) and (select public.is_allowed_user()));

-- NOTIF-5: saves this browser's subscription for the caller. An endpoint is one browser
-- profile, so an endpoint saved before (by this user or the other one, after a sign-out on a
-- shared device) moves to the caller with the new keys. HKP01: the total of 50
-- subscriptions (two users, a few devices each; the daily job reads at most 50) is reached.
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if (select auth.uid()) is null or not public.is_allowed_user() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  -- Serialises concurrent saves, so the limit below cannot be passed by two at once.
  lock table public.push_subscriptions in share row exclusive mode;
  if (
    select count(*) from public.push_subscriptions as s where s.endpoint <> p_endpoint
  ) >= 50 then
    raise exception using errcode = 'HKP01', message = 'Too many push subscriptions.';
  end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      created_by = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent
  returning s.id into saved_id;
  return saved_id;
end;
$$;

comment on function public.save_push_subscription(text, text, text, text) is
  'NOTIF-5: saves (or moves to the caller) this browser''s push subscription.';

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text)
  to authenticated, service_role;

-- NOTIF-9: one row per local date. Written only by the Edge Function (service role).
create table public.reminder_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_date date not null,
  count_tomorrow integer not null,
  count_today integer not null,
  count_overdue integer not null,
  subscriptions_sent integer not null default 0,
  subscriptions_failed integer not null default 0,
  sent_at timestamptz,
  constraint reminder_runs_run_date_key unique (run_date),
  constraint reminder_runs_counts_check check (
    count_tomorrow >= 0 and count_today >= 0 and count_overdue >= 0
    and subscriptions_sent >= 0 and subscriptions_failed >= 0
  )
);

comment on table public.reminder_runs is
  'NOTIF-9: the daily push job, one row per Asia/Jerusalem date (idempotency).';

alter table public.reminder_runs enable row level security;
revoke all on table public.reminder_runs from public, anon, authenticated;
grant all on table public.reminder_runs to service_role;

-- NOTIF-7 / NOTIF-9: claims the run for p_run_date (today in Asia/Jerusalem, passed by the
-- function) and returns the counts of open, not deleted tasks due tomorrow, today and before
-- today. claimed = false: this date already ran, nothing may be sent. When exactly one task
-- counts, its title and group come along (NOTIF-8). The claim comes first, so a crash after
-- it never sends twice.
create function public.claim_reminder_run(p_run_date date)
returns table (
  claimed boolean,
  count_overdue integer,
  count_today integer,
  count_tomorrow integer,
  single_title text,
  single_group text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  overdue integer;
  due_today integer;
  due_tomorrow integer;
  title text;
  task_group text;
begin
  if p_run_date is null then
    raise exception using errcode = '22023', message = 'p_run_date must not be null.';
  end if;
  select
    count(*) filter (where t.due_date < p_run_date),
    count(*) filter (where t.due_date = p_run_date),
    count(*) filter (where t.due_date = p_run_date + 1)
  into overdue, due_today, due_tomorrow
  from public.tasks as t
  where t.status = 'open'
    and t.deleted_at is null
    and t.due_date <= p_run_date + 1;

  insert into public.reminder_runs (run_date, count_tomorrow, count_today, count_overdue)
  values (p_run_date, due_tomorrow, due_today, overdue)
  on conflict (run_date) do nothing;
  if not found then
    return query select false, overdue, due_today, due_tomorrow, null::text, null::text;
    return;
  end if;

  if overdue + due_today + due_tomorrow = 1 then
    select
      t.title,
      case
        when t.due_date < p_run_date then 'overdue'
        when t.due_date = p_run_date then 'today'
        else 'tomorrow'
      end
    into title, task_group
    from public.tasks as t
    where t.status = 'open'
      and t.deleted_at is null
      and t.due_date <= p_run_date + 1;
  end if;
  return query select true, overdue, due_today, due_tomorrow, title, task_group;
end;
$$;

-- NOTIF-9: what the run sent.
create function public.finish_reminder_run(p_run_date date, p_sent integer, p_failed integer)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.reminder_runs
  set subscriptions_sent = p_sent,
      subscriptions_failed = p_failed,
      sent_at = pg_catalog.now()
  where run_date = p_run_date;
$$;

revoke execute on function public.claim_reminder_run(date) from public, anon, authenticated;
revoke execute on function public.finish_reminder_run(date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_reminder_run(date) to service_role;
grant execute on function public.finish_reminder_run(date, integer, integer) to service_role;

-- The cron secret: random, created once per database, never leaves Vault except in the
-- request pg_net makes to the function.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_reminders_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_reminders_cron_secret',
      'M7.2: shared secret between pg_cron (invoke_daily_reminders) and the push Edge Function.'
    );
  end if;
end;
$$;

-- The Edge Function checks the header it received against the secret (by digest, so the
-- comparison time says nothing about the secret).
create function public.verify_reminders_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select extensions.digest(ds.decrypted_secret, 'sha256')
        = extensions.digest(coalesce(p_secret, ''), 'sha256')
      from vault.decrypted_secrets as ds
      where ds.name = 'push_reminders_cron_secret'
    ),
    false
  );
$$;

revoke execute on function public.verify_reminders_secret(text) from public, anon, authenticated;
grant execute on function public.verify_reminders_secret(text) to service_role;

-- Sets the URL of this project's `push` Edge Function (not secret; kept in Vault next to the
-- secret). Only the database owner (migrations workflow, SQL editor) and the service role.
create function public.configure_push_reminders(p_function_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if p_function_url is null or not (
    p_function_url ~ '^https://[a-z0-9-]+(\.[a-z0-9-]+)+/functions/v1/push$'
    or p_function_url ~ '^http://(kong|host\.docker\.internal|127\.0\.0\.1|localhost)(:[0-9]{1,5})?/functions/v1/push$'
  ) then
    raise exception using errcode = '22023', message = 'Not a push function URL.';
  end if;
  select s.id into existing_id from vault.secrets as s where s.name = 'push_reminders_url';
  if existing_id is null then
    perform vault.create_secret(p_function_url, 'push_reminders_url', 'M7.2: push Edge Function URL.');
  else
    perform vault.update_secret(existing_id, p_function_url);
  end if;
end;
$$;

revoke execute on function public.configure_push_reminders(text) from public, anon, authenticated;
grant execute on function public.configure_push_reminders(text) to service_role;

-- NOTIF-16: what each cron run does: one asynchronous POST to the function. Fails (cron run
-- log: failed) when the URL was never configured, instead of silently doing nothing.
create function public.invoke_daily_reminders()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  cron_secret text;
begin
  select ds.decrypted_secret into function_url
  from vault.decrypted_secrets as ds where ds.name = 'push_reminders_url';
  select ds.decrypted_secret into cron_secret
  from vault.decrypted_secrets as ds where ds.name = 'push_reminders_cron_secret';
  if function_url is null or cron_secret is null then
    raise exception using
      errcode = 'HKP02',
      message = 'Push reminders are not configured (docs/setup/push.md).';
  end if;
  return net.http_post(
    url := function_url,
    body := '{"kind":"daily"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', cron_secret
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function public.invoke_daily_reminders() from public, anon, authenticated;
grant execute on function public.invoke_daily_reminders() to service_role;

-- NOTIF-16: 09:00 Asia/Jerusalem is 06:00 UTC in summer time and 07:00 UTC in winter time.
-- cron.schedule() replaces a job of the same name, so this is safe to run again.
select cron.schedule(
  'push-daily-reminders-0600-utc',
  '0 6 * * *',
  'select public.invoke_daily_reminders()'
);
select cron.schedule(
  'push-daily-reminders-0700-utc',
  '0 7 * * *',
  'select public.invoke_daily_reminders()'
);
