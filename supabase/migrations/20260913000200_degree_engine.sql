-- ============================================================================
-- 6 Degrees — the degree engine
--
-- Degrees are DERIVED, never entered. This is the single implementation; the
-- browser only reads the result. The first demo had a second implementation in
-- the generator and the two drifted: 472 of 4,774 edges claimed "same time" when
-- the dates did not overlap, and 2,493 different-time edges displayed an overlap
-- range anyway. One function, one source of truth, so that cannot recur.
--
--   1 same school, same time        4 same city,    different time
--   2 same school, different time   5 same country, same time
--   3 same city,   same time        6 same country, different time
--
-- For a pair, the STRONGEST (lowest) relationship across all their posting pairs
-- wins: share a city and you are a 3 or 4, never a 5 or 6.
-- ============================================================================

-- Do two date ranges overlap? A null end_date means "still there".
create or replace function public.ranges_overlap(
  a_start date, a_end date, b_start date, b_end date
) returns boolean
language sql immutable parallel safe as $$
  select a_start <= coalesce(b_end, 'infinity'::date)
     and b_start <= coalesce(a_end, 'infinity'::date);
$$;

-- The relationship implied by one posting pair, or null if no shared place.
create or replace function public.pair_degree(
  a_school bigint, a_city text, a_country text, a_start date, a_end date,
  b_school bigint, b_city text, b_country text, b_start date, b_end date
) returns table (degree smallint, context_type text, context_label text, same_time boolean)
language sql immutable parallel safe as $$
  with t as (select public.ranges_overlap(a_start, a_end, b_start, b_end) as same)
  select
    case
      when a_school = b_school                    then (case when t.same then 1 else 2 end)
      when a_city is not null and a_city = b_city
           and a_country = b_country              then (case when t.same then 3 else 4 end)
      when a_country = b_country                  then (case when t.same then 5 else 6 end)
    end::smallint,
    case
      when a_school = b_school                    then 'school'
      when a_city is not null and a_city = b_city
           and a_country = b_country              then 'city'
      when a_country = b_country                  then 'country'
    end,
    case
      when a_school = b_school                    then (select name from public.schools where id = a_school)
      when a_city is not null and a_city = b_city
           and a_country = b_country              then a_city || ', ' || a_country
      when a_country = b_country                  then a_country
    end,
    t.same
  from t
  where a_country = b_country;   -- no shared country means no relationship at all
$$;

-- The inclusive year span two postings share, as '2018-2021' or '2018-present'.
--
-- The overlap ENDS when the earlier posting ends, even if the other is still
-- running: if Linda left Addis in 2018 and Dee is still there, they shared
-- 2015-2018, not 2015-present. (Getting this wrong is exactly how the first
-- demo ended up displaying overlap ranges on relationships that had none.)
create or replace function public.overlap_years(
  a_start date, a_end date, b_start date, b_end date
) returns text
language sql immutable parallel safe as $$
  with o as (
    select greatest(a_start, b_start) as s,
           least(coalesce(a_end, 'infinity'::date),
                 coalesce(b_end, 'infinity'::date)) as e
  )
  select case
    when not public.ranges_overlap(a_start, a_end, b_start, b_end) then ''
    when o.e = 'infinity'::date then to_char(o.s, 'YYYY') || '-present'
    when to_char(o.s, 'YYYY') = to_char(o.e, 'YYYY') then to_char(o.s, 'YYYY')
    else to_char(o.s, 'YYYY') || '-' || to_char(o.e, 'YYYY')
  end from o;
$$;

-- Recompute every colleagueship involving one person.
-- Called whenever that person's postings change, and for the other side too.
create or replace function public.recompute_for_profile(p uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.colleagueships
   where profile_a = p or profile_b = p;

  with mine as (
    select po.school_id, s.city, s.country, po.start_date, po.end_date
      from public.postings po join public.schools s on s.id = po.school_id
     where po.profile_id = p
  ),
  theirs as (
    select po.profile_id, po.school_id, s.city, s.country, po.start_date, po.end_date
      from public.postings po join public.schools s on s.id = po.school_id
     where po.profile_id <> p
  ),
  pairs as (
    select t.profile_id as other, d.degree, d.context_type, d.context_label, d.same_time,
           public.overlap_years(m.start_date, m.end_date, t.start_date, t.end_date) as oy
      from mine m
      join theirs t on t.country = m.country          -- only a shared country can relate
      cross join lateral public.pair_degree(
        m.school_id, m.city, m.country, m.start_date, m.end_date,
        t.school_id, t.city, t.country, t.start_date, t.end_date) d
     where d.degree is not null
  ),
  best as (
    select distinct on (other) other, degree, context_type, context_label, same_time, oy
      from pairs
     order by other, degree asc
  )
  insert into public.colleagueships
    (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years, computed_at)
  select least(p, other), greatest(p, other), degree, context_type, context_label,
         case when same_time then 'same time' else 'different time' end,
         case when same_time then oy else '' end,
         now()
    from best
  on conflict (profile_a, profile_b) do update
    set degree = excluded.degree,
        context_type = excluded.context_type,
        context_label = excluded.context_label,
        time_relation = excluded.time_relation,
        overlap_years = excluded.overlap_years,
        computed_at = now();

  get diagnostics n = row_count;
  return n;
end $$;

-- Rebuild the whole table. For migrations and repair, not routine use.
create or replace function public.recompute_all()
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; total integer := 0;
begin
  delete from public.colleagueships;
  for r in select id from public.profiles loop
    total := total + public.recompute_for_profile(r.id);
  end loop;
  return total;
end $$;

-- Keep colleagueships in step with postings automatically.
create or replace function public.postings_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_for_profile(coalesce(new.profile_id, old.profile_id));
  return coalesce(new, old);
end $$;

drop trigger if exists postings_recompute_trg on public.postings;
create trigger postings_recompute_trg
  after insert or update or delete on public.postings
  for each row execute function public.postings_recompute();

-- ── The graph the app reads ─────────────────────────────────────────────────
-- Computed co-location PLUS mutually approved tags. Paul, 13 Sep 2026: "a
-- mutually approved Tag should create a connection" — which is the only way the
-- conference case works, since two people who never shared a country have no
-- computed relationship at all.
--
-- degree is null for a tag-only connection: it is acknowledged, not co-located,
-- and inventing a degree for it would break the rule that degrees come from
-- place and time alone.
create or replace view public.connections as
  select
    c.profile_a, c.profile_b,
    c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
    false as acknowledged,
    null::text as tag_keys
  from public.colleagueships c
  where not exists (
    select 1 from public.connection_tags t
     where t.status = 'approved'
       and least(t.requester_id, t.subject_id) = c.profile_a
       and greatest(t.requester_id, t.subject_id) = c.profile_b
  )
union all
  select
    least(t.requester_id, t.subject_id)    as profile_a,
    greatest(t.requester_id, t.subject_id) as profile_b,
    c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
    true as acknowledged,
    string_agg(distinct t.tag_key, ',')    as tag_keys
  from public.connection_tags t
  left join public.colleagueships c
    on c.profile_a = least(t.requester_id, t.subject_id)
   and c.profile_b = greatest(t.requester_id, t.subject_id)
  where t.status = 'approved'
  group by 1, 2, c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years;
