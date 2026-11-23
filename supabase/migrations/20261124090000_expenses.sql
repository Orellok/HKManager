-- M3: expenses and their receipt files (SPEC sections 5.7 EXP-1..7, 5.14 expense categories,
-- 6 expenses/expense_categories/audit_log, 8).
--
-- * expense_categories: managed by both allowlisted users (owner decision M3): add, rename,
--   reorder, archive and restore. Never deleted by users (no DELETE privilege), so a
--   category with expenses is archived instead; the expenses' foreign key is ON DELETE
--   RESTRICT as well. Seeded with the EXP-3 list, in its order.
-- * expenses: business-level only (EXP-5, no project link). Owner decisions (M3): the amount
--   is more than 0, the date is not in the future (Asia/Jerusalem), soft delete with audit
--   (no physical delete of financial records, SPEC 6).
-- * Receipt files (EXP-2) go to the private "expense-files" bucket at a random path with no
--   personal data (<random uuid>.<jpg|png|pdf>), uploaded by the browser with a signed upload
--   URL and checked by the server before the expense records them (the M2.2 pattern). A file
--   an expense ever recorded can never be removed.

-- Categories (EXP-3 / SPEC 5.14) -------------------------------------------------------------

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  name text not null,
  sort_order integer not null,
  archived_at timestamptz,
  -- Mirrors src/lib/expense-categories/schema.ts.
  constraint expense_categories_name_check check (
    name = btrim(name) and char_length(name) between 1 and 50
  ),
  -- Two categories with one name could not be told apart in the expense form or the filter.
  constraint expense_categories_name_key unique (name),
  constraint expense_categories_sort_order_check check (sort_order between 1 and 1000000),
  -- Deferrable, so move_expense_category() can swap two places in one UPDATE statement.
  constraint expense_categories_sort_order_key unique (sort_order) deferrable initially immediate
);

comment on table public.expense_categories is
  'Expense categories (EXP-3). Never deleted; archived_at set = archived (hidden for new expenses).';
comment on column public.expense_categories.sort_order is
  'Place in the list, set by the database; unique, gaps allowed.';

create index expense_categories_created_by_idx on public.expense_categories (created_by);

create trigger expense_categories_set_updated_at
before update on public.expense_categories
for each row execute function public.set_updated_at();

-- A new category goes last. At most 100 categories (HKC01), so every screen can read the
-- whole list in one bounded query. One writer of the order at a time: inserts and moves take
-- the same transaction-level advisory lock.
create function public.expense_categories_assign_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_count integer;
  last_place integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.expense_categories.order'));
  select count(*), coalesce(max(c.sort_order), 0)
  into category_count, last_place
  from public.expense_categories as c;
  if category_count >= 100 then
    raise exception using
      errcode = 'HKC01',
      message = 'The maximum number of expense categories has been reached.';
  end if;
  new.sort_order := last_place + 1;
  return new;
end;
$$;

revoke execute on function public.expense_categories_assign_sort_order()
  from public, anon, authenticated;

create trigger expense_categories_assign_sort_order
before insert on public.expense_categories
for each row execute function public.expense_categories_assign_sort_order();

-- The time of an archive comes from the database, not from the caller.
create function public.expense_categories_stamp_archived_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    new.archived_at := pg_catalog.now();
  elsif old.archived_at is not null and new.archived_at is not null then
    new.archived_at := old.archived_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.expense_categories_stamp_archived_at()
  from public, anon, authenticated;

create trigger expense_categories_stamp_archived_at
before update of archived_at on public.expense_categories
for each row execute function public.expense_categories_stamp_archived_at();

alter table public.expense_categories enable row level security;

revoke all on table public.expense_categories from public, anon, authenticated;
grant select on table public.expense_categories to authenticated;
-- id, created_*, updated_at and sort_order are set by the database; the order changes only
-- through move_expense_category(). No DELETE: categories are archived (owner decision M3).
grant insert (name) on table public.expense_categories to authenticated;
grant update (name, archived_at) on table public.expense_categories to authenticated;
grant all on table public.expense_categories to service_role;

create policy expense_categories_select_allowed
on public.expense_categories
for select
to authenticated
using ((select public.is_allowed_user()));

create policy expense_categories_insert_allowed
on public.expense_categories
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy expense_categories_update_allowed
on public.expense_categories
for update
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

-- EXP-3 seed (SPEC 5.7), in this order.
insert into public.expense_categories (name)
select seed.name
from unnest(array[
  'תוכנות ורישיונות',
  'רכב ונסיעות',
  'שיווק ופרסום',
  'דוגמאות וחומרים',
  'הדפסות',
  'ציוד משרדי',
  'תקשורת',
  'השתלמויות',
  'ביטוח',
  'שירותים מקצועיים',
  'קבלני משנה (הדמיות)',
  'אחר'
]) with ordinality as seed (name, place)
order by seed.place
on conflict (name) do nothing;

-- Moves an active category one place up or down among the active categories, by swapping
-- places with its nearest active neighbour. Returns the result with the category's resulting
-- place (1-based) among the active categories and their number, read under the lock:
-- 'moved', 'edge' (already first or last; nothing changes) or 'not_found' (no such active
-- category). SECURITY DEFINER, so users need no privilege on sort_order; it checks the
-- allowlist itself.
create function public.move_expense_category(p_category_id uuid, p_direction text)
returns table (result text, place integer, total integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_place integer;
  neighbour_id uuid;
  neighbour_place integer;
begin
  if not public.is_allowed_user() then
    raise exception using errcode = '42501', message = 'Not allowed.';
  end if;
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception using errcode = '22023', message = 'p_direction must be up or down.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.expense_categories.order'));

  -- Read after the lock: a concurrent move may have just changed it.
  select c.sort_order into target_place
  from public.expense_categories as c
  where c.id = p_category_id and c.archived_at is null;
  if target_place is null then
    return query select 'not_found'::text, null::integer, null::integer;
    return;
  end if;

  if p_direction = 'up' then
    select c.id, c.sort_order into neighbour_id, neighbour_place
    from public.expense_categories as c
    where c.archived_at is null and c.sort_order < target_place
    order by c.sort_order desc
    limit 1;
  else
    select c.id, c.sort_order into neighbour_id, neighbour_place
    from public.expense_categories as c
    where c.archived_at is null and c.sort_order > target_place
    order by c.sort_order
    limit 1;
  end if;

  if neighbour_id is not null then
    update public.expense_categories as c
    set sort_order = case when c.id = p_category_id then neighbour_place else target_place end
    where c.id in (p_category_id, neighbour_id);
  end if;

  return query
  select
    case when neighbour_id is null then 'edge' else 'moved' end,
    (
      select count(*)::integer
      from public.expense_categories as c
      where c.archived_at is null
        and c.sort_order <= coalesce(neighbour_place, target_place)
    ),
    (select count(*)::integer from public.expense_categories as c where c.archived_at is null);
end;
$$;

comment on function public.move_expense_category(uuid, text) is
  'EXP-3: swaps an active category with its active neighbour above or below, under a lock.';

revoke execute on function public.move_expense_category(uuid, text) from public, anon;
grant execute on function public.move_expense_category(uuid, text) to authenticated, service_role;

-- Expenses (EXP-1..7 / SPEC 6) -------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  expense_date date not null,
  amount bigint not null,
  vendor text not null,
  category_id uuid not null references public.expense_categories (id) on delete restrict,
  payment_method text not null,
  notes text,
  file_path text,
  deleted_at timestamptz,
  -- Owner decision (M3): more than 0, at most ₪99,999,999.99 (MAX_AGOROT).
  constraint expenses_amount_check check (amount between 1 and 9999999999),
  constraint expenses_expense_date_check check (
    expense_date between '1900-01-01' and '2100-12-31'
  ),
  constraint expenses_vendor_check check (
    vendor = btrim(vendor) and char_length(vendor) between 1 and 120
  ),
  -- The incomes' list (INC-5). Mirrors src/lib/incomes/payment-methods.ts.
  constraint expenses_payment_method_check check (
    payment_method in ('bank_transfer', 'bit_paybox', 'cash', 'check', 'credit_card', 'other')
  ),
  constraint expenses_notes_check check (notes = btrim(notes) and char_length(notes) between 1 and 2000),
  -- A random object name in the expense-files bucket (no personal data, SPEC 8).
  constraint expenses_file_path_check check (
    file_path is null
    or file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
  ),
  -- A file belongs to one expense.
  constraint expenses_file_path_key unique (file_path)
);

comment on table public.expenses is
  'Business expenses (SPEC 5.7). No project link (EXP-5). deleted_at set = soft-deleted (SPEC 6).';
comment on column public.expenses.amount is 'Amount in agorot (integer), more than 0.';
comment on column public.expenses.file_path is
  'Object name in the private "expense-files" bucket; null = missing document (EXP-6).';

-- EXP-4: a month's expenses, newest first.
create index expenses_expense_date_idx on public.expenses (expense_date desc, id)
  where deleted_at is null;
create index expenses_category_id_idx on public.expenses (category_id);
create index expenses_created_by_idx on public.expenses (created_by);

create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

-- The time of a soft delete comes from the database (see incomes_stamp_deleted_at).
create function public.expenses_stamp_deleted_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    new.deleted_at := pg_catalog.now();
  end if;
  return new;
end;
$$;

revoke execute on function public.expenses_stamp_deleted_at() from public, anon, authenticated;

create trigger expenses_stamp_deleted_at
before update of deleted_at on public.expenses
for each row execute function public.expenses_stamp_deleted_at();

-- Checks raised with their own SQLSTATEs so the app can show its own messages:
-- HKE01: the expense date is in the future (Asia/Jerusalem). Checked when the date is set.
-- HKE02: the category is archived. Checked when the category is set, so an existing expense
--        keeps its archived category (owner decision M3).
-- HKE03: the file is not in the expense-files bucket (never uploaded, or removed).
-- The category row and the storage object are locked FOR SHARE until the transaction ends:
-- archiving the category, or removing the file, waits for this write and then sees it (the
-- file's removal is refused: expense_file_was_recorded is VOLATILE and re-reads the
-- committed row, as in the receipts migration).
-- SECURITY DEFINER: the checks must see the object whatever the caller's storage RLS.
create function public.expenses_check_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_archived_at timestamptz;
begin
  if tg_op = 'INSERT' or new.expense_date is distinct from old.expense_date then
    if new.expense_date > (pg_catalog.now() at time zone 'Asia/Jerusalem')::date then
      raise exception using
        errcode = 'HKE01',
        message = 'The expense date is in the future.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    select c.archived_at into category_archived_at
    from public.expense_categories as c
    where c.id = new.category_id
    for share;
    -- A missing category is left to the foreign key check.
    if found and category_archived_at is not null then
      raise exception using
        errcode = 'HKE02',
        message = 'The category is archived.';
    end if;
  end if;

  if new.file_path is not null
    and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path) then
    perform 1
    from storage.objects as o
    where o.bucket_id = 'expense-files'
      and o.name = new.file_path
    for share;
    if not found then
      raise exception using
        errcode = 'HKE03',
        message = 'The expense file is not in storage.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.expenses_check_references() from public, anon, authenticated;

create trigger expenses_check_references
before insert or update of expense_date, category_id, file_path on public.expenses
for each row execute function public.expenses_check_references();

-- Row Level Security: allowlisted users read, record, edit and soft-delete; nobody but the
-- service role can delete. A soft-deleted expense can no longer be changed.
alter table public.expenses enable row level security;

revoke all on table public.expenses from public, anon, authenticated;
grant select on table public.expenses to authenticated;
grant insert (expense_date, amount, vendor, category_id, payment_method, notes, file_path)
  on table public.expenses to authenticated;
grant update (
  expense_date, amount, vendor, category_id, payment_method, notes, file_path, deleted_at
) on table public.expenses to authenticated;
grant all on table public.expenses to service_role;

create policy expenses_select_allowed
on public.expenses
for select
to authenticated
using ((select public.is_allowed_user()));

create policy expenses_insert_allowed
on public.expenses
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy expenses_update_allowed
on public.expenses
for update
to authenticated
using ((select public.is_allowed_user()) and deleted_at is null)
with check ((select public.is_allowed_user()));

-- Audit (SPEC 6): changed fields only, by the rules of audit_incomes(). Notes are free text
-- that may name people, so only the fact that they changed is recorded (SPEC 8).
create function public.audit_expenses()
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
    'expense_date', 'amount', 'vendor', 'category_id', 'payment_method', 'notes', 'file_path',
    'deleted_at'
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
  values (auth.uid(), 'expenses', new.id, audit_action, diff);
  return null;
end;
$$;

revoke execute on function public.audit_expenses() from public, anon, authenticated;

create trigger expenses_audit
after insert or update on public.expenses
for each row execute function public.audit_expenses();

-- Files an expense ever recorded (as in recorded_receipt_files): such files can never be
-- removed, also after the expense's file was replaced or the expense was soft-deleted.
create table public.recorded_expense_files (
  path text primary key,
  created_at timestamptz not null default now(),
  expense_id uuid not null references public.expenses (id) on delete restrict
);

comment on table public.recorded_expense_files is
  'Every expense-files path an expense ever recorded; such files can never be removed (SPEC 6).';

create index recorded_expense_files_expense_id_idx on public.recorded_expense_files (expense_id);

alter table public.recorded_expense_files enable row level security;

revoke all on table public.recorded_expense_files from public, anon, authenticated;
grant all on table public.recorded_expense_files to service_role;

create function public.remember_expense_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.file_path is not null then
    insert into public.recorded_expense_files (path, expense_id)
    values (new.file_path, new.id)
    on conflict (path) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.remember_expense_file() from public, anon, authenticated;

create trigger expenses_remember_file
after insert or update of file_path on public.expenses
for each row execute function public.remember_expense_file();

-- Whether an expense-files path was ever recorded; answers allowlisted users only. VOLATILE,
-- so a DELETE that waited for a recording re-reads the committed row.
create function public.expense_file_was_recorded(p_path text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_allowed_user()
    and exists (select 1 from public.recorded_expense_files as r where r.path = p_path);
$$;

revoke execute on function public.expense_file_was_recorded(text) from public, anon;
grant execute on function public.expense_file_was_recorded(text) to authenticated, service_role;

-- Lists (EXP-4 / EXP-6) ---------------------------------------------------------------------

-- One page of a month's expenses that are not deleted, optionally of one category, whose
-- vendor contains p_vendor (case-insensitive), and/or only those without a file (EXP-6).
-- Newest expense date first, then the newest recorded. Pages hold at most 100 rows.
create function public.list_expenses(
  p_month date,
  p_category_id uuid default null,
  p_vendor text default null,
  p_missing_document boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  expense_date date,
  amount bigint,
  vendor text,
  payment_method text,
  category_id uuid,
  category_name text,
  has_file boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    e.id,
    e.expense_date,
    e.amount,
    e.vendor,
    e.payment_method,
    c.id,
    c.name,
    e.file_path is not null
  from public.expenses as e
  join public.expense_categories as c on c.id = e.category_id
  where e.deleted_at is null
    and e.expense_date >= p_month
    and e.expense_date < (p_month + interval '1 month')::date
    and (p_category_id is null or e.category_id = p_category_id)
    and (
      coalesce(p_vendor, '') = ''
      or pg_catalog.strpos(pg_catalog.lower(e.vendor), pg_catalog.lower(p_vendor)) > 0
    )
    and (not coalesce(p_missing_document, false) or e.file_path is null)
  order by e.expense_date desc, e.created_at desc, e.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.list_expenses(date, uuid, text, boolean, integer, integer) is
  'EXP-4 / EXP-6: bounded page of a month''s expenses with the filters, newest first.';

-- The number and the total (agorot) of the expenses the same filters select.
create function public.expenses_summary(
  p_month date,
  p_category_id uuid default null,
  p_vendor text default null,
  p_missing_document boolean default false
)
returns table (expense_count bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*), coalesce(sum(e.amount), 0)::bigint
  from public.expenses as e
  where e.deleted_at is null
    and e.expense_date >= p_month
    and e.expense_date < (p_month + interval '1 month')::date
    and (p_category_id is null or e.category_id = p_category_id)
    and (
      coalesce(p_vendor, '') = ''
      or pg_catalog.strpos(pg_catalog.lower(e.vendor), pg_catalog.lower(p_vendor)) > 0
    )
    and (not coalesce(p_missing_document, false) or e.file_path is null);
$$;

comment on function public.expenses_summary(date, uuid, text, boolean) is
  'EXP-4: count and total of the expenses the list filters select.';

revoke execute on function public.list_expenses(date, uuid, text, boolean, integer, integer)
  from public, anon;
revoke execute on function public.expenses_summary(date, uuid, text, boolean) from public, anon;
grant execute on function public.list_expenses(date, uuid, text, boolean, integer, integer)
  to authenticated, service_role;
grant execute on function public.expenses_summary(date, uuid, text, boolean)
  to authenticated, service_role;

-- Storage (EXP-2) ---------------------------------------------------------------------------

-- The private bucket for expense receipts: JPEG, PNG or PDF, at most 10MB after the browser
-- compressed an image (owner decision M3). The app also checks the bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-files', 'expense-files', false, 10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Only allowlisted users reach objects in the bucket. Reading also covers creating the
-- short-lived signed URLs used for viewing.
create policy expense_files_select_allowed
on storage.objects
for select
to authenticated
using (bucket_id = 'expense-files' and (select public.is_allowed_user()));

-- Uploads go to a random <uuid>.<jpg|png|pdf> at the bucket's root.
create policy expense_files_insert_allowed
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'expense-files'
  and (select public.is_allowed_user())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$'
);

-- Only an upload that was never recorded (it failed the checks, or the save failed) can be
-- removed. No UPDATE policy: files are never overwritten.
create policy expense_files_delete_never_recorded
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'expense-files'
  and (select public.is_allowed_user())
  and not public.expense_file_was_recorded(objects.name)
);
