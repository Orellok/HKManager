-- M2.2: receipts documentation, manual mode (SPEC sections 5.5 INC-3/INC-4/INC-6, 5.6
-- DOC-1..6, 6 documents/app_settings/audit_log, 8 and 9.1).
--
-- * app_settings holds the receipt provider's name and link and the monthly quota (seeded
--   here; owner decision: no editing screen in M2.2). Allowlisted users read it; only an
--   admin writes it.
-- * documents records the receipt issued at the provider for an income: one per income
--   (INC-6), a receipt number unique per provider and type (DOC-3), and either a PDF in the
--   private "receipts" Storage bucket or an https link. Users can insert and edit it (owner
--   decision: every change is in audit_log) but never delete it.
-- * INC-4: once an income has a document, the income itself can no longer be changed or
--   soft-deleted, for every writer. Recording a document locks the income row (FOR SHARE),
--   and an income update locks it too, so the two always run one after the other and the
--   later one sees the earlier one's result.
-- * The "receipts" bucket and its storage.objects policies are created here, so staging and
--   production get them from the migration like every other schema change.

-- Settings (SPEC 5.14 / 6) -------------------------------------------------------------------

create table public.app_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  key text not null,
  value jsonb not null,
  constraint app_settings_key_key unique (key),
  constraint app_settings_key_check check (key ~ '^[a-z][a-z0-9_]{0,62}$')
);

comment on table public.app_settings is
  'Application settings as key/value (SPEC 5.14). Read by allowlisted users, written by admins.';

create index app_settings_created_by_idx on public.app_settings (created_by);

create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from public, anon, authenticated;
grant select, delete on table public.app_settings to authenticated;
grant insert (key, value) on table public.app_settings to authenticated;
grant update (value) on table public.app_settings to authenticated;
grant all on table public.app_settings to service_role;

create policy app_settings_select_allowed
on public.app_settings
for select
to authenticated
using ((select public.is_allowed_user()));

-- AUTH-5: system settings are admin only.
create policy app_settings_insert_admin
on public.app_settings
for insert
to authenticated
with check ((select public.is_admin()));

create policy app_settings_update_admin
on public.app_settings
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy app_settings_delete_admin
on public.app_settings
for delete
to authenticated
using ((select public.is_admin()));

-- DOC-4 seed values (SPEC 5.6). The app reads them through src/lib/app-settings.ts, which
-- falls back to the same defaults when a value is missing or invalid.
insert into public.app_settings (key, value)
values
  ('receipt_provider_name', '"SUMIT"'),
  ('receipt_provider_url', '"https://app.sumit.co.il/"'),
  ('receipt_monthly_quota', '10')
on conflict (key) do nothing;

-- The provider a new document is recorded with: the configured provider name. Used as the
-- column default, so users cannot choose it (they have no INSERT privilege on the column).
create function public.receipt_provider_name()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select s.value #>> '{}'
  from public.app_settings as s
  where s.key = 'receipt_provider_name'
    and pg_catalog.jsonb_typeof(s.value) = 'string';
$$;

revoke execute on function public.receipt_provider_name() from public, anon;
grant execute on function public.receipt_provider_name() to authenticated, service_role;

-- Documents (SPEC 5.6 / 6) -------------------------------------------------------------------

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  income_id uuid not null references public.incomes (id) on delete restrict,
  -- DOC-6: a single document type in V1.
  doc_type text not null default 'receipt',
  provider text not null default public.receipt_provider_name(),
  -- Stage 2 (DOC-7): the provider's id of a document issued through its API.
  external_id text,
  doc_number text not null,
  issued_date date not null,
  file_path text,
  url text,
  -- INC-6: one payment = one income = one receipt.
  constraint documents_income_id_key unique (income_id),
  -- DOC-3.
  constraint documents_doc_number_key unique (provider, doc_type, doc_number),
  constraint documents_doc_type_check check (doc_type in ('receipt')),
  constraint documents_provider_check check (
    provider = btrim(provider) and char_length(provider) between 1 and 100
  ),
  constraint documents_external_id_check check (
    external_id is null or char_length(external_id) between 1 and 200
  ),
  -- Mirrors src/lib/documents/schema.ts: letters, digits, "-" and "/", up to 30 characters.
  constraint documents_doc_number_check check (
    doc_number ~ '^[0-9A-Za-z][0-9A-Za-z/-]{0,29}$'
  ),
  constraint documents_issued_date_check check (
    issued_date between '1900-01-01' and '2100-12-31'
  ),
  -- DOC-2 / owner decision: either an uploaded PDF or a link, never both.
  constraint documents_source_check check (pg_catalog.num_nonnulls(file_path, url) = 1),
  -- The object path: the income's id, then a random file name (no personal data, SPEC 8).
  constraint documents_file_path_check check (
    file_path is null
    or file_path ~ (
      '^' || income_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
    )
  ),
  -- Owner decision: an https link only.
  constraint documents_url_check check (
    url is null or (url ~ '^https://[^/?#\s]+([/?#]\S*)?$' and char_length(url) <= 2000)
  )
);

comment on table public.documents is
  'Receipts issued at the provider for incomes (SPEC 5.6). Never deleted; changes are audited.';
comment on column public.documents.file_path is
  'Object name in the private "receipts" Storage bucket: <income id>/<random uuid>.pdf.';

-- DOC-4: receipts issued in a month.
create index documents_issued_date_idx on public.documents (issued_date);
create index documents_created_by_idx on public.documents (created_by);

create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

-- Checks raised with their own SQLSTATEs so the app can show its own messages:
-- HKD01: the issue date is in the future (Asia/Jerusalem). Checked when the date is set.
-- HKD02: the income is soft-deleted; no receipt can be recorded for it.
-- HKD03: the file is not in the receipts bucket (it was never uploaded, or was removed).
-- Recording a document locks its income row FOR SHARE until the transaction ends: an
-- income update (which locks the row for update) waits for it, then INC-4 refuses it; a
-- document recorded while an income update runs waits for that update, then sees it.
-- SECURITY DEFINER: the checks must see every income and object whatever the caller's RLS
-- (a locking read of incomes applies its UPDATE policy, which hides deleted incomes).
create function public.documents_check_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  income_deleted_at timestamptz;
begin
  if tg_op = 'INSERT' then
    select i.deleted_at into income_deleted_at
    from public.incomes as i
    where i.id = new.income_id
    for share;
    -- A missing or invisible income is left to the foreign key and RLS checks.
    if found and income_deleted_at is not null then
      raise exception using
        errcode = 'HKD02',
        message = 'The income is deleted; no receipt can be recorded for it.';
    end if;
  end if;

  if tg_op = 'INSERT' or new.issued_date is distinct from old.issued_date then
    if new.issued_date > (pg_catalog.now() at time zone 'Asia/Jerusalem')::date then
      raise exception using
        errcode = 'HKD01',
        message = 'The issue date is in the future.';
    end if;
  end if;

  if new.file_path is not null
    and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path)
    and not exists (
      select 1
      from storage.objects as o
      where o.bucket_id = 'receipts'
        and o.name = new.file_path
    ) then
    raise exception using
      errcode = 'HKD03',
      message = 'The receipt file is not in storage.';
  end if;
  return new;
end;
$$;

revoke execute on function public.documents_check_references() from public, anon, authenticated;

create trigger documents_check_references
before insert or update of issued_date, file_path on public.documents
for each row execute function public.documents_check_references();

-- INC-4: an income that has a document cannot be changed or soft-deleted (HKI05), whoever
-- writes. The UPDATE has locked the income row before this runs, so a document being
-- recorded meanwhile has either committed (and is seen here) or waits until this ends.
-- SECURITY DEFINER, so the check sees every document whatever the caller's RLS.
create function public.incomes_locked_by_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.documents as d where d.income_id = old.id) then
    raise exception using
      errcode = 'HKI05',
      message = 'The income has a receipt; it cannot be changed or deleted.';
  end if;
  return new;
end;
$$;

revoke execute on function public.incomes_locked_by_document() from public, anon, authenticated;

create trigger incomes_locked_by_document
before update on public.incomes
for each row execute function public.incomes_locked_by_document();

-- Row Level Security: allowlisted users read, record and edit; nobody but the service role
-- can delete (owner decision: a recorded receipt cannot be deleted).
alter table public.documents enable row level security;

revoke all on table public.documents from public, anon, authenticated;
grant select on table public.documents to authenticated;
-- id, created_*, updated_at, doc_type, provider and external_id are set by the database.
grant insert (income_id, doc_number, issued_date, file_path, url)
  on table public.documents to authenticated;
-- Owner decision: the receipt details stay editable; the income it belongs to does not.
grant update (doc_number, issued_date, file_path, url) on table public.documents to authenticated;
grant all on table public.documents to service_role;

create policy documents_select_allowed
on public.documents
for select
to authenticated
using ((select public.is_allowed_user()));

create policy documents_insert_allowed
on public.documents
for insert
to authenticated
with check ((select public.is_allowed_user()));

create policy documents_update_allowed
on public.documents
for update
to authenticated
using ((select public.is_allowed_user()))
with check ((select public.is_allowed_user()));

-- Audit (SPEC 6, owner decision): every insert and update with the changed fields only, by
-- the same rules as audit_incomes(). A link may carry a token, so only the fact that it
-- changed is recorded; a file path holds ids only and is recorded as is.
create function public.audit_documents()
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
begin
  foreach field in array array[
    'income_id', 'doc_type', 'provider', 'external_id', 'doc_number', 'issued_date',
    'file_path', 'url'
  ] loop
    if (old_row -> field) is distinct from (new_row -> field)
      and not (tg_op = 'INSERT' and new_row -> field = 'null'::jsonb) then
      if field = 'url' then
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
  insert into public.audit_log (actor, entity, entity_id, action, diff)
  values (
    auth.uid(), 'documents', new.id,
    case when tg_op = 'INSERT' then 'insert' else 'update' end,
    diff
  );
  return null;
end;
$$;

revoke execute on function public.audit_documents() from public, anon, authenticated;

create trigger documents_audit
after insert or update on public.documents
for each row execute function public.audit_documents();

-- Lists and counters ------------------------------------------------------------------------

-- INC-1 / INC-3: the incomes list now also says whether each income has a receipt. The
-- return type changes, so the function is dropped and created again.
drop function public.list_incomes(date, uuid, integer, integer);

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
  milestone_description text,
  receipt_issued boolean
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
    m.description,
    exists (select 1 from public.documents as d where d.income_id = i.id)
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
  'INC-1 / INC-3: bounded page of a month''s incomes with their receipt status, newest first.';

-- DOC-5: one page of the incomes that are not deleted and have no receipt, of every month,
-- oldest received date first (the longest waiting first). Pages hold at most 100 rows.
create function public.list_pending_receipts(
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
  milestone_description text,
  receipt_issued boolean
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
    m.description,
    false
  from public.incomes as i
  join public.clients as c on c.id = i.client_id
  left join public.projects as p on p.id = i.project_id
  left join public.milestones as m on m.id = i.milestone_id
  where i.deleted_at is null
    and not exists (select 1 from public.documents as d where d.income_id = i.id)
  order by i.received_date, i.created_at, i.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.list_pending_receipts(integer, integer) is
  'DOC-5: bounded page of incomes waiting for a receipt, oldest received date first.';

-- DOC-5 / DOC-4: the number of incomes waiting for a receipt, and the number of receipts
-- issued in the current month in Asia/Jerusalem (by issued_date).
create function public.receipts_summary()
returns table (pending_count bigint, issued_this_month bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with this_month as (
    select pg_catalog.date_trunc(
      'month', (pg_catalog.now() at time zone 'Asia/Jerusalem')::date
    )::date as first_day
  )
  select
    (
      select count(*)
      from public.incomes as i
      where i.deleted_at is null
        and not exists (select 1 from public.documents as d where d.income_id = i.id)
    ),
    (
      select count(*)
      from public.documents as d, this_month as t
      where d.doc_type = 'receipt'
        and d.issued_date >= t.first_day
        and d.issued_date < (t.first_day + interval '1 month')::date
    );
$$;

comment on function public.receipts_summary() is
  'DOC-4 / DOC-5: incomes waiting for a receipt, and receipts issued this month (Asia/Jerusalem).';

revoke execute on function public.list_incomes(date, uuid, integer, integer) from public, anon;
revoke execute on function public.list_pending_receipts(integer, integer) from public, anon;
revoke execute on function public.receipts_summary() from public, anon;
grant execute on function public.list_incomes(date, uuid, integer, integer)
  to authenticated, service_role;
grant execute on function public.list_pending_receipts(integer, integer)
  to authenticated, service_role;
grant execute on function public.receipts_summary() to authenticated, service_role;

-- Storage (DOC-2) ---------------------------------------------------------------------------

-- The private bucket for receipt PDFs: PDF only, at most 10MB (owner decision). Storage
-- itself refuses other content types and larger files; the app also checks the bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['application/pdf'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Only allowlisted users reach objects in the bucket (AUTH-4). Reading also covers creating
-- the short-lived signed URLs used for viewing.
create policy receipts_select_allowed
on storage.objects
for select
to authenticated
using (bucket_id = 'receipts' and (select public.is_allowed_user()));

-- Uploads go to <income id>/<random uuid>.pdf of an income that exists and is not deleted.
create policy receipts_insert_allowed
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and (select public.is_allowed_user())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  and exists (
    select 1
    from public.incomes as i
    where i.id::text = (storage.foldername(name))[1]
      and i.deleted_at is null
  )
);

-- An upload that was never recorded (it failed the checks, or the save failed) can be
-- removed; the file of a recorded receipt cannot. There is no UPDATE policy: files are
-- never overwritten.
create policy receipts_delete_unrecorded
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and (select public.is_allowed_user())
  and not exists (select 1 from public.documents as d where d.file_path = objects.name)
);
