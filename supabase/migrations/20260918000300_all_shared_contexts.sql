-- ============================================================================
-- Show every way two people are connected, not only the strongest.
--
-- Dave, 13 Sep 2026: "Linda is only listed as a Degree 1 connection, even though
-- we are technically also Degree 2 and Degree 4 connections as well (we were both
-- at ASW in Poland, but during different years)." Linda, the same evening: "Robb
-- and I only show 1 1st degree connection, but we have almost all of the schools
-- the same."
--
-- Both are the same missing feature. colleagueships stores ONE row per pair — the
-- strongest relationship — so everything else two people share is computed and
-- then thrown away. Linda and Robb share seven schools and see one line.
--
-- WHAT DOES NOT CHANGE: the headline degree. colleagueships still holds the
-- strongest (lowest) degree per pair, and that is still what places someone on a
-- ring. The six degrees are fixed and a pair still has exactly one of them.
--
-- WHAT IS ADDED: shared_contexts, one row per distinct thing a pair shares —
-- every school, every city, every country, each with its own time relation and
-- overlap. Linda and Robb get seven degree-1 rows, one per school.
--
-- Both tables are filled by the SAME `pairs` CTE inside recompute_for_profile, in
-- one statement. That matters: the first demo had the degree rules implemented
-- twice and the two drifted, and 472 edges ended up claiming an overlap they did
-- not have. There is still exactly one implementation.
-- ============================================================================

create table if not exists public.shared_contexts (
  profile_a     uuid not null references public.profiles on delete cascade,
  profile_b     uuid not null references public.profiles on delete cascade,
  degree        smallint not null check (degree between 1 and 6),
  context_type  text not null check (context_type in ('school','city','country')),
  context_label text not null,
  time_relation text not null check (time_relation in ('same time','different time')),
  -- '' for a different-time relationship. Part of the key because two separate
  -- stints at one school are two genuinely different overlaps worth showing:
  -- Linda at ASD 2010-2012 and 2016-2019 against Robb at ASD 2011-2018.
  overlap_years text not null default '',
  primary key (profile_a, profile_b, degree, context_label, overlap_years),
  check (profile_a < profile_b)
);
create index if not exists shared_contexts_b_idx on public.shared_contexts (profile_b);

alter table public.shared_contexts enable row level security;

-- Same rule as colleagueships: any signed-in member sees the graph.
-- Paul, 13 Sep 2026, answering who can see whom: "Everyone can see everyone."
drop policy if exists shared_contexts_read on public.shared_contexts;
create policy shared_contexts_read on public.shared_contexts
  for select to authenticated using (public.is_member());

-- ── Recompute: both tables, one pass, one definition of the rules ───────────
create or replace function public.recompute_for_profile(p uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.colleagueships  where profile_a = p or profile_b = p;
  delete from public.shared_contexts where profile_a = p or profile_b = p;

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
  ),
  -- The headline, unchanged: one row per pair, strongest degree wins.
  headline as (
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
          computed_at = now()
    returning 1
  )
  -- The detail: everything else the pair shares.
  insert into public.shared_contexts
    (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years)
  select distinct
         least(p, other), greatest(p, other), degree, context_type, context_label,
         case when same_time then 'same time' else 'different time' end,
         case when same_time then oy else '' end
    from pairs
  on conflict do nothing;

  -- Count the headline rows, which is what this function has always returned.
  select count(*) into n from public.colleagueships where profile_a = p or profile_b = p;
  return n;
end $$;

-- recompute_all clears colleagueships directly, so it has to clear the detail too.
create or replace function public.recompute_all()
returns integer
language plpgsql security definer set search_path = public as $$
declare r record; total integer := 0;
begin
  delete from public.shared_contexts;
  delete from public.colleagueships;
  for r in select id from public.profiles loop
    total := total + public.recompute_for_profile(r.id);
  end loop;
  return total;
end $$;

-- Backfill: every existing pair only ever had its headline stored.
select public.recompute_all();
