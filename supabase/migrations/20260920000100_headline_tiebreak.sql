-- ============================================================================
-- When several connections tie at the same degree, show the one that matters.
--
-- Paul, 20 Sep 2026: Liz is his spouse and they are at the American School of
-- Dubai together, so why does her row say Escola Americana de Campinas?
--
-- Because they share THREE schools — Maracaibo, Campinas and Dubai — all at the
-- same time, so all three are degree 1. The headline was chosen with
--
--     select distinct on (other) ... order by other, degree asc
--
-- and `degree asc` alone does not break a tie. Among equally strong links the
-- one kept was whichever the query plan happened to produce first. It picked a
-- school they left five years ago.
--
-- It is not just them. On the live data right now:
--     Linda + Robb    7 links tied at degree 1  ->  American School Kuwait (left 1995)
--     Liz  + Paul     3 tied                    ->  Campinas (left 2021)
--     Bob  + Linda    2 tied                    ->  AES Delhi
--     Bob  + Robb     2 tied                    ->  AES Delhi
--
-- Linda and Robb are married, have moved together for thirty years, and the app
-- was describing their marriage by a job they left in 1995.
--
-- THE TIE-BREAK, in order:
--   1. the strongest degree, as always — this does not change
--   2. one you are BOTH still in, because "where we are together now" is the
--      most useful thing a single line can say
--   3. failing that, the most recently started
--
-- Nothing about the six degrees changes. This only decides which of several
-- equally true labels gets the one line available.
-- ============================================================================

create or replace function public.recompute_for_profile(p uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.colleagueships  where profile_a = p or profile_b = p;
  delete from public.shared_contexts where profile_a = p or profile_b = p;

  with mine as (
    select po.school_id,
           case when s.city_confidence in ('high','medium') then s.city end as city,
           s.region, s.country, po.start_date, po.end_date
      from public.postings po join public.schools s on s.id = po.school_id
     where po.profile_id = p
  ),
  theirs as (
    select po.profile_id, po.school_id,
           case when s.city_confidence in ('high','medium') then s.city end as city,
           s.region, s.country, po.start_date, po.end_date
      from public.postings po join public.schools s on s.id = po.school_id
     where po.profile_id <> p
  ),
  pairs as (
    select t.profile_id as other, d.degree, d.context_type, d.context_label, d.same_time,
           public.overlap_years(m.start_date, m.end_date, t.start_date, t.end_date) as oy,
           -- when the two of you were in the same place at once, and whether you
           -- still are. Only used to choose the headline; the degrees are untouched.
           greatest(m.start_date, t.start_date) as overlap_start,
           (m.end_date is null and t.end_date is null) as both_still_there
      from mine m
      join theirs t on t.country = m.country
      cross join lateral public.pair_degree(
        m.school_id, m.city, m.region, m.country, m.start_date, m.end_date,
        t.school_id, t.city, t.region, t.country, t.start_date, t.end_date) d
     where d.degree is not null
  ),
  best as (
    select distinct on (other)
           other, degree, context_type, context_label, same_time, oy
      from pairs
     -- strongest first, then where you still are, then the most recent
     order by other, degree asc, both_still_there desc, overlap_start desc
  ),
  headline as (
    insert into public.colleagueships
      (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years, computed_at)
    select least(p, other), greatest(p, other), degree, context_type, context_label,
           case when same_time then 'same time' else 'different time' end,
           case when same_time then oy else '' end, now()
      from best
    on conflict (profile_a, profile_b) do update
      set degree = excluded.degree, context_type = excluded.context_type,
          context_label = excluded.context_label, time_relation = excluded.time_relation,
          overlap_years = excluded.overlap_years, computed_at = now()
    returning 1
  )
  insert into public.shared_contexts
    (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years)
  select distinct least(p, other), greatest(p, other), degree, context_type, context_label,
         case when same_time then 'same time' else 'different time' end,
         case when same_time then oy else '' end
    from pairs
  on conflict do nothing;

  select count(*) into n from public.colleagueships where profile_a = p or profile_b = p;
  return n;
end $$;

select public.recompute_all();
