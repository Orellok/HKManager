-- M4.1: dashboard and the exempt-dealer ceiling (SPEC sections 4, 5.9 DASH-1..6, 5.10
-- CEIL-1..6, 5.14, 6 tax_year_settings/ceiling_alert_acks/aggregation views, 8).
--
-- * tax_year_settings: the exempt-dealer ceiling per calendar tax year (DASH-6), in agorot.
--   Allowlisted users read it; only an admin adds or changes it (CEIL-1, AUTH-5). Never
--   deleted. Seeded with 2026 = 12,283,300 agorot (SPEC 4).
-- * ceiling_alert_acks: CEIL-4 acknowledgements of the 70/85/95% banners, one per year and
--   threshold, shared by both users. Inserted only (who and when are set by the database);
--   never changed or deleted by users.
-- * app_settings.turnover_basis (CEIL-2): 'received_date' (the income's received date) or
--   'receipt_date' (the issue date of the income's receipt). Seeded 'received_date'; a
--   missing or invalid value counts as 'received_date'.
-- * Aggregations run in the database (SPEC 8): monthly income and expense views, and one
--   dashboard function that returns every number the dashboard shows in one round trip.
--   Months and years are calendar dates in Asia/Jerusalem: the dates are DATE columns, and
--   "today" is passed by the app (todayInJerusalem(), as for open debts).

-- Ceilings (CEIL-1) --------------------------------------------------------------------------

create table public.tax_year_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  year integer not null,
  exempt_ceiling bigint not null,
  constraint tax_year_settings_year_key unique (year),
  -- The app's date range (src/lib/dates.ts).
  constraint tax_year_settings_year_check check (year between 1900 and 2100),
  -- More than 0, at most ₪99,999,999.99 (MAX_AGOROT).
  constraint tax_year_settings_exempt_ceiling_check check (
    exempt_ceiling between 1 and 9999999999
  )
);

comment on table public.tax_year_settings is
  'CEIL-1: the exempt-dealer turnover ceiling of each calendar tax year (DASH-6).';
comment on column public.tax_year_settings.exempt_ceiling is 'Ceiling in agorot (integer).';

create index tax_year_settings_created_by_idx on public.tax_year_settings (created_by);

create trigger tax_year_settings_set_updated_at
before update on public.tax_year_settings
for each row execute function public.set_updated_at();

alter table public.tax_year_settings enable row level security;

revoke all on table public.tax_year_settings from public, anon, authenticated;
grant select on table public.tax_year_settings to authenticated;
-- The year of a row never changes (a wrong year is a new row); no DELETE.
grant insert (year, exempt_ceiling) on table public.tax_year_settings to authenticated;
grant update (exempt_ceiling) on table public.tax_year_settings to authenticated;
grant all on table public.tax_year_settings to service_role;

create policy tax_year_settings_select_allowed
on public.tax_year_settings
for select
to authenticated
using ((select public.is_allowed_user()));

-- AUTH-5 / CEIL-1: the yearly update is the admin's.
create policy tax_year_settings_insert_admin
on public.tax_year_settings
for insert
to authenticated
with check ((select public.is_admin()));

create policy tax_year_settings_update_admin
on public.tax_year_settings
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- SPEC 4 / CEIL-1: ₪122,833 for 2026.
insert into public.tax_year_settings (year, exempt_ceiling)
values (2026, 12283300)
on conflict (year) do nothing;

-- Banner acknowledgements (CEIL-4) -----------------------------------------------------------

create table public.ceiling_alert_acks (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  threshold integer not null,
  acked_by uuid default auth.uid() references auth.users (id) on delete set null,
  acked_at timestamptz not null default now(),
  constraint ceiling_alert_acks_year_threshold_key unique (year, threshold),
  constraint ceiling_alert_acks_year_check check (year between 1900 and 2100),
  -- Mirrors CEILING_THRESHOLDS in src/lib/ceiling/status.ts. 100% has no acknowledgement
  -- (CEIL-5: that banner cannot be dismissed).
  constraint ceiling_alert_acks_threshold_check check (threshold in (70, 85, 95))
);

comment on table public.ceiling_alert_acks is
  'CEIL-4: a ceiling banner acknowledged for a year and threshold (shared by both users).';

create index ceiling_alert_acks_acked_by_idx on public.ceiling_alert_acks (acked_by);

alter table public.ceiling_alert_acks enable row level security;

revoke all on table public.ceiling_alert_acks from public, anon, authenticated;
grant select on table public.ceiling_alert_acks to authenticated;
-- acked_by and acked_at come from the database; no UPDATE or DELETE.
grant insert (year, threshold) on table public.ceiling_alert_acks to authenticated;
grant all on table public.ceiling_alert_acks to service_role;

create policy ceiling_alert_acks_select_allowed
on public.ceiling_alert_acks
for select
to authenticated
using ((select public.is_allowed_user()));

create policy ceiling_alert_acks_insert_allowed
on public.ceiling_alert_acks
for insert
to authenticated
with check ((select public.is_allowed_user()));

-- Acknowledges a threshold of a year and every lower one (a banner stands for every
-- threshold below it, so none of them comes back). Already acknowledged thresholds keep
-- their first acknowledgement. SECURITY INVOKER: privileges and RLS apply.
create function public.acknowledge_ceiling_alert(p_year integer, p_threshold integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_threshold is null or p_threshold not in (70, 85, 95) then
    raise exception using errcode = '22023', message = 'p_threshold must be 70, 85 or 95.';
  end if;
  insert into public.ceiling_alert_acks (year, threshold)
  select p_year, t.threshold
  from unnest(array[70, 85, 95]) as t (threshold)
  where t.threshold <= p_threshold
  on conflict (year, threshold) do nothing;
end;
$$;

comment on function public.acknowledge_ceiling_alert(integer, integer) is
  'CEIL-4: records the acknowledgement of a threshold and every lower one for a year.';

revoke execute on function public.acknowledge_ceiling_alert(integer, integer) from public, anon;
grant execute on function public.acknowledge_ceiling_alert(integer, integer)
  to authenticated, service_role;

-- Turnover basis (CEIL-2) --------------------------------------------------------------------

insert into public.app_settings (key, value)
values ('turnover_basis', '"received_date"')
on conflict (key) do nothing;

-- The configured basis; anything but 'receipt_date' counts as 'received_date' (the SPEC
-- default), so a bad row can never stop the dashboard.
create function public.turnover_basis()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.app_settings as s
      where s.key = 'turnover_basis' and s.value = '"receipt_date"'::jsonb
    ) then 'receipt_date'
    else 'received_date'
  end;
$$;

revoke execute on function public.turnover_basis() from public, anon;
grant execute on function public.turnover_basis() to authenticated, service_role;

-- CEIL-2: the turnover of a calendar tax year in agorot: the incomes that are not deleted,
-- by received date, or with the 'receipt_date' basis by the issue date of their receipt
-- (an income without a receipt does not count then).
create function public.tax_year_turnover(p_year integer)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select
      pg_catalog.make_date(p_year, 1, 1) as first_day,
      pg_catalog.make_date(p_year + 1, 1, 1) as next_year
  )
  select case public.turnover_basis()
    when 'receipt_date' then (
      select coalesce(sum(i.amount), 0)::bigint
      from public.incomes as i
      join public.documents as d on d.income_id = i.id
      cross join bounds as b
      where i.deleted_at is null
        and d.doc_type = 'receipt'
        and d.issued_date >= b.first_day
        and d.issued_date < b.next_year
    )
    else (
      select coalesce(sum(i.amount), 0)::bigint
      from public.incomes as i
      cross join bounds as b
      where i.deleted_at is null
        and i.received_date >= b.first_day
        and i.received_date < b.next_year
    )
  end;
$$;

comment on function public.tax_year_turnover(integer) is
  'CEIL-2: turnover (agorot) of a calendar tax year by the turnover_basis setting.';

revoke execute on function public.tax_year_turnover(integer) from public, anon;
grant execute on function public.tax_year_turnover(integer) to authenticated, service_role;

-- Monthly aggregations (SPEC 6 views) --------------------------------------------------------

-- security_invoker: the caller's RLS on incomes and expenses applies.
create view public.income_monthly_totals
with (security_invoker = true)
as
select
  pg_catalog.date_trunc('month', i.received_date::timestamp)::date as month,
  sum(i.amount)::bigint as total,
  count(*) as income_count
from public.incomes as i
where i.deleted_at is null
group by 1;

comment on view public.income_monthly_totals is
  'DASH-2/3: incomes that are not deleted, summed (agorot) per received month.';

create view public.expense_monthly_totals
with (security_invoker = true)
as
select
  pg_catalog.date_trunc('month', e.expense_date::timestamp)::date as month,
  sum(e.amount)::bigint as total,
  count(*) as expense_count
from public.expenses as e
where e.deleted_at is null
group by 1;

comment on view public.expense_monthly_totals is
  'DASH-2/3: expenses that are not deleted, summed (agorot) per expense month.';

revoke all on table public.income_monthly_totals from public, anon, authenticated;
revoke all on table public.expense_monthly_totals from public, anon, authenticated;
grant select on table public.income_monthly_totals to authenticated, service_role;
grant select on table public.expense_monthly_totals to authenticated, service_role;

-- The dashboard (DASH-1..5, CEIL-3..6) --------------------------------------------------------

-- Everything the dashboard shows, in one round trip, as JSON (amounts in agorot):
-- * period: p_period 'month' or 'year' starting at p_period_start (the first of a month, or
--   1 January); income and expense totals of the period and of the one before it (DASH-2);
-- * series: the 12 months ending with the period's month (a month) or January to December
--   (a year), each with its income and expense totals (DASH-3);
-- * categories: the period's expenses per category, largest first (DASH-4);
-- * cards: open debts (MS-6 rules, as of p_today), incomes waiting for a receipt, receipts
--   issued this month (DOC-4/5), and expenses without a document in p_today's month (DASH-5);
-- * ceiling: the period's tax year, its ceiling (null when not set, CEIL-6), turnover by the
--   basis (CEIL-2), the acknowledged thresholds (CEIL-4) and whether the caller is an admin.
-- SECURITY INVOKER: every read goes through the caller's RLS.
create function public.dashboard_data(p_period text, p_period_start date, p_today date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  step interval;
  period_end date;
  previous_start date;
  series_start date;
  today_month date;
  tax_year integer;
  income_current bigint;
  income_previous bigint;
  expense_current bigint;
  expense_previous bigint;
  series jsonb;
  categories jsonb;
  debts record;
  receipts record;
  missing_documents bigint;
  ceiling bigint;
  acks jsonb;
begin
  if p_period = 'month' then
    step := interval '1 month';
  elsif p_period = 'year' then
    step := interval '1 year';
  else
    raise exception using errcode = '22023', message = 'p_period must be month or year.';
  end if;
  if p_period_start is null
    or p_period_start < '1900-01-01'
    or p_period_start > '2100-12-31'
    or p_period_start <> pg_catalog.date_trunc(p_period, p_period_start::timestamp)::date then
    raise exception using
      errcode = '22023',
      message = 'p_period_start must be the first day of the period, 1900-2100.';
  end if;
  if p_today is null then
    raise exception using errcode = '22023', message = 'p_today is required.';
  end if;

  period_end := (p_period_start + step)::date;
  previous_start := (p_period_start - step)::date;
  series_start := case
    when p_period = 'month' then (p_period_start - interval '11 months')::date
    else p_period_start
  end;
  today_month := pg_catalog.date_trunc('month', p_today::timestamp)::date;
  tax_year := extract(year from p_period_start)::integer;

  -- DASH-2: the views hold whole months and both periods are whole months.
  select
    coalesce(sum(t.total) filter (where t.month >= p_period_start), 0)::bigint,
    coalesce(sum(t.total) filter (where t.month < p_period_start), 0)::bigint
  into income_current, income_previous
  from public.income_monthly_totals as t
  where t.month >= previous_start and t.month < period_end;

  select
    coalesce(sum(t.total) filter (where t.month >= p_period_start), 0)::bigint,
    coalesce(sum(t.total) filter (where t.month < p_period_start), 0)::bigint
  into expense_current, expense_previous
  from public.expense_monthly_totals as t
  where t.month >= previous_start and t.month < period_end;

  -- DASH-3.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'month', pg_catalog.to_char(m.month, 'YYYY-MM'),
        'income', coalesce(i.total, 0),
        'expense', coalesce(e.total, 0)
      )
      order by m.month
    ),
    '[]'::jsonb
  )
  into series
  from (
    select g::date as month
    from pg_catalog.generate_series(
      series_start::timestamp, (series_start + interval '11 months')::timestamp, interval '1 month'
    ) as g
  ) as m
  left join public.income_monthly_totals as i on i.month = m.month
  left join public.expense_monthly_totals as e on e.month = m.month;

  -- DASH-4: at most 100 categories exist (HKC01).
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', c.id, 'name', c.name, 'total', c.total, 'count', c.expense_count
      )
      order by c.total desc, c.sort_order
    ),
    '[]'::jsonb
  )
  into categories
  from (
    select
      cat.id, cat.name, cat.sort_order, sum(x.amount)::bigint as total, count(*) as expense_count
    from public.expenses as x
    join public.expense_categories as cat on cat.id = x.category_id
    where x.deleted_at is null
      and x.expense_date >= p_period_start
      and x.expense_date < period_end
    group by cat.id, cat.name, cat.sort_order
  ) as c;

  -- DASH-5.
  select * into debts from public.open_debts_summary(p_today);
  select * into receipts from public.receipts_summary();
  select count(*) into missing_documents
  from public.expenses as x
  where x.deleted_at is null
    and x.file_path is null
    and x.expense_date >= today_month
    and x.expense_date < (today_month + interval '1 month')::date;

  -- CEIL-3..6.
  select s.exempt_ceiling into ceiling
  from public.tax_year_settings as s
  where s.year = tax_year;
  select coalesce(pg_catalog.jsonb_agg(a.threshold order by a.threshold), '[]'::jsonb)
  into acks
  from public.ceiling_alert_acks as a
  where a.year = tax_year;

  return pg_catalog.jsonb_build_object(
    'period', pg_catalog.jsonb_build_object(
      'income', income_current,
      'expense', expense_current,
      'previous_income', income_previous,
      'previous_expense', expense_previous
    ),
    'series', series,
    'categories', categories,
    'cards', pg_catalog.jsonb_build_object(
      'open_debts_count', debts.debt_count,
      'open_debts_total', debts.total_balance,
      'pending_receipts', receipts.pending_count,
      'receipts_issued_this_month', receipts.issued_this_month,
      'missing_documents', missing_documents
    ),
    'ceiling', pg_catalog.jsonb_build_object(
      'year', tax_year,
      'ceiling', ceiling,
      'turnover', public.tax_year_turnover(tax_year),
      'basis', public.turnover_basis(),
      'acked', acks,
      'is_admin', public.is_admin()
    )
  );
end;
$$;

comment on function public.dashboard_data(text, date, date) is
  'DASH-1..5 / CEIL-2..6: every dashboard number for a month or year, in one round trip.';

revoke execute on function public.dashboard_data(text, date, date) from public, anon;
grant execute on function public.dashboard_data(text, date, date) to authenticated, service_role;
