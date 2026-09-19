-- ============================================================================
-- Put degrees 5 and 6 back. Paul's call, 19 Sep 2026: "I want degrees 5 and 6
-- to stay for now."
--
-- 20260919000500 stopped storing them. It should never have been applied: I had
-- told Paul I would hold it until I could show it was faster, and then pushed it
-- as a side effect of pushing an unrelated migration, because `db push` applies
-- everything pending and I had left it in the folder.
--
-- The case for removing them was half sound. The storage arithmetic is real —
-- 2.5 million rows at 3,000 members, past the free tier on that table alone, and
-- degrees 5 and 6 are about two thirds of it. The performance case was not: I
-- projected the recompute cost by straight-line extrapolation from seven
-- members, twice wrote a "faster" query that was slower, and both times measured
-- against a synthetic dataset that turned out to have every posting at the same
-- school. None of that was established when it shipped.
--
-- So this restores the engine exactly as it was in 20260918000800 and rebuilds.
-- Nothing else in that migration is reverted: the city-confidence rule still
-- applies, so a guessed city still cannot invent a shared city.
--
-- The scaling question stays open and stays real. It should be reopened with
-- measurements on data that resembles the network, and a decision made on
-- evidence rather than on my confidence.
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
           public.overlap_years(m.start_date, m.end_date, t.start_date, t.end_date) as oy
      from mine m
      join theirs t on t.country = m.country
      cross join lateral public.pair_degree(
        m.school_id, m.city, m.region, m.country, m.start_date, m.end_date,
        t.school_id, t.city, t.region, t.country, t.start_date, t.end_date) d
     where d.degree is not null
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

select public.recompute_all();
