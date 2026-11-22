-- M2.2 review, round 2.
--
-- 1. Recording a receipt and removing its file cannot race. Before, a removal that ran
--    while a document recording that file was still uncommitted saw neither the document
--    nor its recorded_receipt_files row, so it removed the file, and the document then
--    committed pointing to nothing. Now documents_check_references locks the storage object
--    row (FOR SHARE) when it checks the file exists, so a concurrent DELETE of that object
--    waits until the recording commits or rolls back; receipt_file_was_recorded is VOLATILE,
--    so when the waiting DELETE re-checks the policy it reads the committed row and refuses.
-- 2. recorded_receipt_files keeps its rows: document_id is ON DELETE RESTRICT (documents
--    are never deleted by users; the service role must remove these rows first).
-- 3. receipt_file_was_recorded answers allowlisted users only.

create or replace function public.documents_check_references()
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
    and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path) then
    -- Locked until this transaction ends: a removal of the file waits for it (see above).
    perform 1
    from storage.objects as o
    where o.bucket_id = 'receipts'
      and o.name = new.file_path
    for share;
    if not found then
      raise exception using
        errcode = 'HKD03',
        message = 'The receipt file is not in storage.';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.documents_check_references() from public, anon, authenticated;

create or replace function public.receipt_file_was_recorded(p_path text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select public.is_allowed_user()
    and exists (select 1 from public.recorded_receipt_files as r where r.path = p_path);
$$;

alter table public.recorded_receipt_files
  drop constraint recorded_receipt_files_document_id_fkey,
  add constraint recorded_receipt_files_document_id_fkey
    foreign key (document_id) references public.documents (id) on delete restrict;
