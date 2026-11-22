-- M2.2 review, round 1.
--
-- 1. A receipt file that was ever recorded can never be removed (SPEC 6, owner decision: a
--    recorded receipt cannot be deleted). receipts_delete_unrecorded only checked the
--    current documents.file_path, so the old file of a receipt whose file was replaced (or
--    switched to a link) became deletable. Every path a document ever pointed to is now kept
--    in recorded_receipt_files, written by a trigger on documents, and the delete policy
--    refuses those paths.
--
--    A dedicated table rather than a lookup in audit_log: audit_log is a log (its diff is
--    unindexed jsonb, and a future retention or cleanup must not reopen deletion), while
--    this table is indexed by path, has one purpose, and users can neither read nor write
--    it.
--
-- 2. The provider default never yields NULL: a missing or invalid setting falls back to the
--    SPEC seed value "SUMIT" (DOC-4), as src/lib/app-settings.ts does.

create table public.recorded_receipt_files (
  path text primary key,
  created_at timestamptz not null default now(),
  document_id uuid not null references public.documents (id) on delete cascade
);

comment on table public.recorded_receipt_files is
  'Every receipts-bucket path a document ever recorded; such files can never be removed (SPEC 6).';

create index recorded_receipt_files_document_id_idx
  on public.recorded_receipt_files (document_id);

-- RLS on, no policies and no privileges for users: only the trigger (as its owner) and the
-- service role write it; the storage policy reads it through a SECURITY DEFINER function.
alter table public.recorded_receipt_files enable row level security;

revoke all on table public.recorded_receipt_files from public, anon, authenticated;
grant all on table public.recorded_receipt_files to service_role;

-- Files already recorded before this migration: current paths and, from the audit log,
-- every path a document pointed to before an edit.
insert into public.recorded_receipt_files (path, document_id)
select d.file_path, d.id
from public.documents as d
where d.file_path is not null
on conflict (path) do nothing;

insert into public.recorded_receipt_files (path, document_id)
select a.diff -> 'file_path' ->> 'old', a.entity_id
from public.audit_log as a
join public.documents as d on d.id = a.entity_id
where a.entity = 'documents'
  and a.diff -> 'file_path' ->> 'old' is not null
on conflict (path) do nothing;

create function public.remember_receipt_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.file_path is not null then
    insert into public.recorded_receipt_files (path, document_id)
    values (new.file_path, new.id)
    on conflict (path) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.remember_receipt_file() from public, anon, authenticated;

create trigger documents_remember_receipt_file
after insert or update of file_path on public.documents
for each row execute function public.remember_receipt_file();

-- Whether a receipts-bucket path was ever recorded by a document.
create function public.receipt_file_was_recorded(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.recorded_receipt_files as r where r.path = p_path);
$$;

revoke execute on function public.receipt_file_was_recorded(text) from public, anon;
grant execute on function public.receipt_file_was_recorded(text) to authenticated, service_role;

drop policy receipts_delete_unrecorded on storage.objects;

-- Only an upload that was never recorded (it failed the checks, or the save failed) can be
-- removed. There is still no UPDATE policy: files are never overwritten.
create policy receipts_delete_never_recorded
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and (select public.is_allowed_user())
  and not public.receipt_file_was_recorded(objects.name)
);

create or replace function public.receipt_provider_name()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select pg_catalog.btrim(s.value #>> '{}')
      from public.app_settings as s
      where s.key = 'receipt_provider_name'
        and pg_catalog.jsonb_typeof(s.value) = 'string'
        and pg_catalog.btrim(s.value #>> '{}') <> ''
    ),
    'SUMIT'
  );
$$;
