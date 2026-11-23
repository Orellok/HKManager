-- M4.2: CSV export (SPEC 5.11 EXPORT-1..3) and an M4.1 carry-over (CEIL-4).
--
-- The export reads a date range page by page with a keyset cursor (received/expense date,
-- created_at, id): every page is bounded, a row is never skipped or repeated while rows are
-- added or soft-deleted between pages, and the Route Handler holds one page in memory at a
-- time. SECURITY INVOKER: the caller's privileges and RLS apply (allowlisted users only).

-- EXPORT-1 / EXPORT-3: the incomes that are not deleted, received from p_from to p_to
-- (inclusive), oldest first, with their receipt (number and issue date) when recorded.
create function public.export_incomes(
  p_from date,
  p_to date,
  p_after_date date default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns table (
  id uuid,
  created_at timestamptz,
  received_date date,
  client_name text,
  project_name text,
  milestone_description text,
  amount bigint,
  payment_method text,
  receipt_number text,
  receipt_date date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.created_at,
    i.received_date,
    c.name,
    p.name,
    m.description,
    i.amount,
    i.payment_method,
    d.doc_number,
    d.issued_date
  from public.incomes as i
  join public.clients as c on c.id = i.client_id
  left join public.projects as p on p.id = i.project_id
  left join public.milestones as m on m.id = i.milestone_id
  -- INC-6: at most one receipt per income (documents_income_id_key).
  left join public.documents as d on d.income_id = i.id and d.doc_type = 'receipt'
  where i.deleted_at is null
    and i.received_date >= p_from
    and i.received_date <= p_to
    and (
      p_after_id is null
      or (i.received_date, i.created_at, i.id) > (p_after_date, p_after_created_at, p_after_id)
    )
  order by i.received_date, i.created_at, i.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.export_incomes(date, date, date, timestamptz, uuid, integer) is
  'EXPORT-1/3: bounded keyset page of the incomes of a date range with receipts, oldest first.';

-- EXPORT-1 / EXPORT-3: the expenses that are not deleted, from p_from to p_to (inclusive),
-- oldest first, with their category and whether a document is attached.
create function public.export_expenses(
  p_from date,
  p_to date,
  p_after_date date default null,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns table (
  id uuid,
  created_at timestamptz,
  expense_date date,
  vendor text,
  category_name text,
  amount bigint,
  payment_method text,
  has_file boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.created_at,
    e.expense_date,
    e.vendor,
    c.name,
    e.amount,
    e.payment_method,
    e.file_path is not null
  from public.expenses as e
  join public.expense_categories as c on c.id = e.category_id
  where e.deleted_at is null
    and e.expense_date >= p_from
    and e.expense_date <= p_to
    and (
      p_after_id is null
      or (e.expense_date, e.created_at, e.id) > (p_after_date, p_after_created_at, p_after_id)
    )
  order by e.expense_date, e.created_at, e.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

comment on function public.export_expenses(date, date, date, timestamptz, uuid, integer) is
  'EXPORT-1/3: bounded keyset page of the expenses of a date range, oldest first.';

revoke execute on function public.export_incomes(date, date, date, timestamptz, uuid, integer)
  from public, anon;
revoke execute on function public.export_expenses(date, date, date, timestamptz, uuid, integer)
  from public, anon;
grant execute on function public.export_incomes(date, date, date, timestamptz, uuid, integer)
  to authenticated, service_role;
grant execute on function public.export_expenses(date, date, date, timestamptz, uuid, integer)
  to authenticated, service_role;

-- CEIL-4 (M4.1 carry-over): a threshold can be acknowledged only once the year's turnover
-- has reached it. Checked by a trigger, so every writer is held to it (acknowledge_ceiling_alert()
-- and a direct insert alike). HKC01: the year has no ceiling, or its turnover is below the
-- threshold. Compared in numeric, so no product can overflow. Runs with the caller's
-- privileges and RLS: an account outside the allowlist sees no ceiling and is refused.
create function public.ceiling_alert_acks_require_crossed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_ceiling bigint;
begin
  select s.exempt_ceiling into v_ceiling
  from public.tax_year_settings as s
  where s.year = new.year;
  if v_ceiling is null
    or public.tax_year_turnover(new.year)::numeric * 100 < v_ceiling::numeric * new.threshold then
    raise exception using
      errcode = 'HKC01',
      message = 'The year''s turnover has not reached this threshold.';
  end if;
  return new;
end;
$$;

revoke execute on function public.ceiling_alert_acks_require_crossed()
  from public, anon, authenticated;

create trigger ceiling_alert_acks_require_crossed
before insert on public.ceiling_alert_acks
for each row execute function public.ceiling_alert_acks_require_crossed();

comment on function public.acknowledge_ceiling_alert(integer, integer) is
  'CEIL-4: acknowledges a crossed threshold and every lower one for a year (HKC01 if not crossed).';
