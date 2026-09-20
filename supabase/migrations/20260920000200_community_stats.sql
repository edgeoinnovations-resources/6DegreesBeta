-- ============================================================================
-- How big is this community? One cheap question, answered server-side.
--
-- Paul, 20 Sep 2026: a counter on the Connections page — fun and visible, but
-- simple. The point is watching it grow: a network of seven is a curiosity, a
-- network of seven hundred is a tool, and the number is what tells you which one
-- you are looking at.
--
-- Server-side because the opening screen no longer holds the whole network —
-- it loads your own neighbourhood. Four counts in one round trip cost nothing
-- and stay constant as the membership grows, where counting in the browser would
-- have meant downloading everyone to say how many there are.
-- ============================================================================

create or replace function public.community_stats()
returns table (
  members     bigint,
  schools     bigint,
  countries   bigint,
  connections bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.profiles where status = 'active'),
    (select count(distinct po.school_id) from public.postings po),
    (select count(distinct s.country)
       from public.postings po join public.schools s on s.id = po.school_id),
    (select count(*) from public.colleagueships);
$$;

revoke execute on function public.community_stats() from public, anon;
grant  execute on function public.community_stats() to authenticated;
