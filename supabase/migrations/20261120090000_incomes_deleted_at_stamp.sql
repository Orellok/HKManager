-- M2.1 review: the time of a soft delete comes from the database.
--
-- Users may update incomes.deleted_at (that is how an income is soft-deleted), so without
-- this they could store any timestamp, in the past or the future, as the deletion time. The
-- trigger replaces it with now() when an income goes from not deleted to deleted. A deleted
-- income cannot be updated by users at all (incomes_update_allowed reaches only rows that
-- are not deleted), so the stamp cannot be changed afterwards either.

create function public.incomes_stamp_deleted_at()
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

revoke execute on function public.incomes_stamp_deleted_at() from public, anon, authenticated;

create trigger incomes_stamp_deleted_at
before update of deleted_at on public.incomes
for each row execute function public.incomes_stamp_deleted_at();
