-- M1.3 polish: bound milestones.sort_order, and let move_milestone() report where the
-- milestone ended up.
--
-- sort_order is updatable by allowlisted users (move_milestone runs as the caller), so a
-- direct write of a huge value (2147483647) would make "last place + 1" overflow on every
-- later insert of that project. The new upper bound keeps it far from the integer limit, and
-- the insert trigger renumbers the project's list 1..n when the next place would pass it.

alter table public.milestones
  add constraint milestones_sort_order_max_check check (sort_order <= 1000000);

comment on column public.milestones.sort_order is
  'Place in the project''s list (MS-1), set by the database; unique per project, 1..1000000, gaps allowed.';

create or replace function public.milestones_assign_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  milestone_count integer;
  last_place integer;
begin
  -- Serializes inserts and moves of the same project (see move_milestone). FOR NO KEY UPDATE
  -- does not block the foreign key checks of other tables (they take FOR KEY SHARE).
  perform 1 from public.projects as p where p.id = new.project_id for no key update;
  select count(*), coalesce(max(m.sort_order), 0)
  into milestone_count, last_place
  from public.milestones as m
  where m.project_id = new.project_id;
  if milestone_count >= 100 then
    raise exception using
      errcode = 'HKM01',
      message = 'The project already has the maximum number of milestones.';
  end if;
  -- The last place is at the bound (only after a direct write of a large sort_order):
  -- renumber the list 1..n in its current order, in one statement (the unique constraint is
  -- deferrable, so the shifted places do not collide mid-statement).
  if last_place >= 1000000 then
    update public.milestones as m
    set sort_order = renumbered.place
    from (
      select r.id, row_number() over (order by r.sort_order, r.id) as place
      from public.milestones as r
      where r.project_id = new.project_id
    ) as renumbered
    where m.id = renumbered.id;
    last_place := milestone_count;
  end if;
  new.sort_order := last_place + 1;
  return new;
end;
$$;

revoke execute on function public.milestones_assign_sort_order() from public, anon, authenticated;

-- move_milestone now returns the result with the milestone's resulting place (1-based) in
-- its project's list and the list's length, read under the lock, so the app announces what
-- the database did rather than what a possibly stale screen showed. 'edge' reports the
-- current place; 'not_found' has no place.
drop function public.move_milestone(uuid, text);

create function public.move_milestone(p_milestone_id uuid, p_direction text)
returns table (result text, place integer, total integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_project_id uuid;
  target_place integer;
  neighbour_id uuid;
  neighbour_place integer;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception using errcode = '22023', message = 'p_direction must be up or down.';
  end if;

  select m.project_id into target_project_id from public.milestones as m where m.id = p_milestone_id;
  if target_project_id is null then
    return query select 'not_found'::text, null::integer, null::integer;
    return;
  end if;

  -- One writer of this project's order at a time (inserts take the same lock).
  perform 1 from public.projects as p where p.id = target_project_id for no key update;

  -- Read the place only after the lock: a concurrent move may have just changed it. Each
  -- statement of a READ COMMITTED transaction sees what was committed before it started.
  select m.sort_order into target_place from public.milestones as m where m.id = p_milestone_id;
  if target_place is null then
    return query select 'not_found'::text, null::integer, null::integer;
    return;
  end if;

  if p_direction = 'up' then
    select m.id, m.sort_order into neighbour_id, neighbour_place
    from public.milestones as m
    where m.project_id = target_project_id and m.sort_order < target_place
    order by m.sort_order desc
    limit 1;
  else
    select m.id, m.sort_order into neighbour_id, neighbour_place
    from public.milestones as m
    where m.project_id = target_project_id and m.sort_order > target_place
    order by m.sort_order
    limit 1;
  end if;

  if neighbour_id is not null then
    update public.milestones as m
    set sort_order = case when m.id = p_milestone_id then neighbour_place else target_place end
    where m.id in (p_milestone_id, neighbour_id);
  end if;

  return query
  select
    case when neighbour_id is null then 'edge' else 'moved' end,
    (
      select count(*)::integer
      from public.milestones as m
      where m.project_id = target_project_id
        and m.sort_order <= coalesce(neighbour_place, target_place)
    ),
    (select count(*)::integer from public.milestones as m where m.project_id = target_project_id);
end;
$$;

comment on function public.move_milestone(uuid, text) is
  'MS-1: swaps a milestone with its neighbour above or below, under a per-project lock; returns the result, the resulting place and the list length.';

revoke execute on function public.move_milestone(uuid, text) from public, anon;
grant execute on function public.move_milestone(uuid, text) to authenticated, service_role;
