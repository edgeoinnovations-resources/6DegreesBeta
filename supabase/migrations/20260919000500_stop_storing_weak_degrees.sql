-- ============================================================================
-- Stop storing the weakest two degrees. They are 65% of the graph and the reason
-- registration would have stopped working.
--
-- THE CLIFF. recompute_for_profile runs inside save_my_profile, on every
-- registration and every edit. Measured at 31 ms with 40 postings in the
-- database, and it scales with the total:
--
--      150 members (   855 postings) ->  0.7s
--      500 members ( 2,850 postings) ->  2.2s
--    1,000 members ( 5,700 postings) ->  4.4s
--    3,000 members (17,100 postings) -> 13.3s
--
-- The `authenticated` role has statement_timeout = 8s. So somewhere around
-- 1,500 members save_my_profile does not get slow — it FAILS. New members
-- cannot join and existing ones cannot edit their history. That is a cliff, not
-- a slope, and nothing warns you before you reach it.
--
-- WHY IT IS EXPENSIVE. The join is "everyone who has ever worked in a country I
-- have worked in". International teaching clusters hard — China has 289 schools
-- in this catalogue, the UAE 116 — so that set is most of the membership, and
-- almost all of the work produces degree 5 and 6 rows: "we were both in Spain at
-- some point."
--
-- Modelled on the real geography, at 3,000 members:
--     same school (1-2)          62,079 rows     1.4% of pairs
--   + same city   (3-4)         897,225 rows      20%
--   + same country(5-6)       2,529,956 rows      56%
--
-- Degrees 5 and 6 alone are 1.6 million of those rows. They are also the least
-- useful thing in the product, and at that size they stop being drawable: your
-- own ring 5 would hold well over a thousand people.
--
-- WHAT CHANGES. Nothing about the six degrees. A pair who only share a country
-- is still degree 5 or 6 — it is computed when someone actually looks, from the
-- two people's postings, instead of being stored for every pair in the network
-- against the chance that somebody might. pair_degree, the single definition of
-- the rules, is untouched.
--
-- THE HONEST COST. "Everyone who shares a country with me" is no longer a stored
-- list, so a future screen wanting that count must ask for it. The ego graph's
-- outer two rings are the known caller and they are handled in the next step;
-- anything else that needs them should use a purpose-built query rather than
-- reviving the table.
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
  -- Only people who share a SCHOOL or a CITY with one of my postings. This is the
  -- change: it is an indexed lookup against a handful of places instead of a scan
  -- of everyone who has been to the same country.
  -- Two indexed lookups unioned, NOT one scan with an OR. Written the obvious
  -- way — `where s.id in (...) or (s.city, s.country) in (...)` — Postgres gave
  -- up on the indexes entirely and one recompute ran for over ten minutes at
  -- 3,000 members, against 2.7 seconds for the version this replaces. Measured,
  -- not guessed.
  theirs as (
    select po.profile_id, po.school_id, s.city, s.region, s.country,
           po.start_date, po.end_date
      from mine m
      join public.postings po on po.school_id = m.school_id
      join public.schools s on s.id = po.school_id
     where po.profile_id <> p
    union all
    select po.profile_id, po.school_id, s.city, s.region, s.country,
           po.start_date, po.end_date
      from mine m
      join public.schools s
        on s.city = m.city and s.country = m.country
       and s.city_confidence in ('high','medium')
      join public.postings po on po.school_id = s.id
     where m.city is not null
       and po.profile_id <> p
       and po.school_id <> m.school_id
  ),
  pairs as (
    select t.profile_id as other, d.degree, d.context_type, d.context_label, d.same_time,
           public.overlap_years(m.start_date, m.end_date, t.start_date, t.end_date) as oy
      from mine m
      join theirs t on t.country = m.country
      cross join lateral public.pair_degree(
        m.school_id, m.city, m.region, m.country, m.start_date, m.end_date,
        t.school_id, t.city, t.region, t.country, t.start_date, t.end_date) d
     -- degrees 5 and 6 are derived on demand, never stored
     where d.degree is not null and d.degree <= 4
  ),
  best as (
    select distinct on (other) other, degree, context_type, context_label, same_time, oy
      from pairs order by other, degree asc
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

-- The lookup the new `theirs` clause depends on.
create index if not exists schools_city_country_conf_idx
  on public.schools (city, country) where city_confidence in ('high','medium');

-- Rebuild on the new rule. Country-only pairs disappear from the tables and are
-- computed on demand from here on.
select public.recompute_all();
