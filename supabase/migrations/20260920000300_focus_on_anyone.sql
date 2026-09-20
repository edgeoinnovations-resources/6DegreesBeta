-- ============================================================================
-- Look at anybody's connections, not only your own.
--
-- The group changed its mind, 20 Sep 2026. On 12 Sep Melissa asked to always
-- stay at her own centre and Dee said she should not be able to "search as Paul
-- and see how many degrees are between you and someone else", and that is what
-- was built. The group now wants to choose anyone and see their circles.
--
-- It is defensible, and worth writing down why: the graph is ARITHMETIC OVER
-- DATA EVERY MEMBER CAN ALREADY SEE. Anyone can open Linda's card, read her nine
-- postings and Dee's eight, and work out they overlapped in Doha. This does not
-- disclose anything new; it stops people doing the sum by hand.
--
-- Two functions, mirroring ones that already exist:
--   connections_of(person) — my_connections() for somebody else
--   find_members(query)    — a name or school search, so the picker works when
--                            the community is thousands rather than nine
--
-- Neither will look at a GHOST. Somebody who left does not become browsable.
-- ============================================================================

create or replace function public.connections_of(p_person uuid)
returns table (
  other_id           uuid,
  display_name       text,
  first_name         text,
  last_name          text,
  preferred_name     text,
  status             text,
  degree             smallint,
  context_type       text,
  context_label      text,
  time_relation      text,
  overlap_years      text,
  acknowledged       boolean,
  tag_keys           text,
  their_degree_count bigint,
  home_country       text
)
language sql
stable
security invoker
set search_path = public
as $$
  with subject as (
    -- a ghost, or somebody who does not exist, yields nothing at all
    select p.id from public.profiles p
     where p.id = p_person and p.status = 'active'
  ),
  theirs as (
    select
      case when c.profile_a = (select id from subject) then c.profile_b else c.profile_a end as other_id,
      c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
      c.acknowledged, c.tag_keys
    from public.connections c, subject s
    where c.profile_a = s.id or c.profile_b = s.id
  )
  select
    t.other_id,
    p.display_name, p.first_name, p.last_name, p.preferred_name, p.status,
    t.degree, t.context_type, t.context_label, t.time_relation, t.overlap_years,
    t.acknowledged, t.tag_keys,
    (select count(*) from public.colleagueships k
      where k.profile_a = t.other_id or k.profile_b = t.other_id),
    (select s.country
       from public.postings po join public.schools s on s.id = po.school_id
      where po.profile_id = t.other_id
      order by (po.end_date is null) desc, po.start_date desc
      limit 1)
  from theirs t
  join public.public_profiles p on p.id = t.other_id;
$$;

revoke execute on function public.connections_of(uuid) from public, anon;
grant  execute on function public.connections_of(uuid) to authenticated;

-- ── Finding somebody ────────────────────────────────────────────────────────
-- One box that searches BOTH a person's name and the schools they have worked
-- at, because "who else was at ASD" is how this community actually thinks, and
-- because one box is kinder than three to somebody who does not want to learn a
-- new interface.
create or replace function public.find_members(p_query text default null, p_limit int default 40)
returns table (
  id            uuid,
  display_name  text,
  current_place text,
  matched_school text,
  my_degree     smallint
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (select nullif(btrim(coalesce(p_query, '')), '') as term)
  select
    p.id,
    p.display_name,
    -- where they are now, so two people with the same name are tellable apart
    (select s.name || ' · ' || coalesce(s.city, s.country)
       from public.postings po join public.schools s on s.id = po.school_id
      where po.profile_id = p.id
      order by (po.end_date is null) desc, po.start_date desc
      limit 1),
    -- which school matched, when that is why they are in the list
    (select s.name
       from public.postings po join public.schools s on s.id = po.school_id, q
      where po.profile_id = p.id
        and q.term is not null
        and s.name ilike '%' || q.term || '%'
      limit 1),
    (select c.degree from public.colleagueships c
      where (c.profile_a = least(auth.uid(), p.id) and c.profile_b = greatest(auth.uid(), p.id)))
  from public.public_profiles p, q
  where p.status = 'active'
    and (
      q.term is null
      or p.display_name ilike '%' || q.term || '%'
      or exists (
        select 1 from public.postings po join public.schools s on s.id = po.school_id
         where po.profile_id = p.id and s.name ilike '%' || q.term || '%'
      )
    )
  order by
    -- your own people first: the person you want is usually one you know
    (select 1 from public.colleagueships c
      where c.profile_a = least(auth.uid(), p.id) and c.profile_b = greatest(auth.uid(), p.id)) nulls last,
    p.display_name
  limit greatest(1, least(coalesce(p_limit, 40), 100));
$$;

revoke execute on function public.find_members(text, int) from public, anon;
grant  execute on function public.find_members(text, int) to authenticated;
