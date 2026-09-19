-- ============================================================================
-- Ask for your own connections instead of downloading everyone's.
--
-- Every page load currently pulls the entire graph into the browser. At seven
-- members that is 11 kB and invisible. Measured and modelled against the real
-- school geography, where density sits at ~56% because "we both worked in Spain
-- at some point" connects almost everybody:
--
--      150 members ->     6,280 rows ->     1 MB per page load
--      500 members ->    70,109 rows ->     9 MB
--    1,000 members ->   280,719 rows ->    35 MB
--    3,000 members -> 2,528,157 rows ->   307 MB
--
-- The free tier allows 5 GB of egress a month. At 500 members that is a few
-- hundred sign-ins.
--
-- Nothing on the opening screen needs any of it. The rings show YOUR connections
-- and the card shows ONE pair. Both are O(your connections), not O(everyone
-- squared). This function returns exactly that, and everything the ego graph
-- needs to draw without a second query:
--
--   * the degree and its context, from the connections view (which already
--     folds in mutually approved tags)
--   * their name, for the label and the rail
--   * how many connections they have, which sizes the node
--   * the country of their most recent posting, which is how the rings group
--     people geographically rather than by insertion order
--
-- SECURITY INVOKER on purpose. It reads public.connections and public_profiles,
-- both of which are themselves security_invoker and gated by is_member(), so the
-- caller's own permissions apply exactly as they do today. This function widens
-- nothing; it only asks a narrower question.
-- ============================================================================

create or replace function public.my_connections()
returns table (
  other_id        uuid,
  display_name    text,
  first_name      text,
  last_name       text,
  preferred_name  text,
  status          text,
  degree          smallint,
  context_type    text,
  context_label   text,
  time_relation   text,
  overlap_years   text,
  acknowledged    boolean,
  tag_keys        text,
  their_degree_count bigint,
  home_country    text
)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (select auth.uid() as id),
  mine as (
    select
      case when c.profile_a = (select id from me) then c.profile_b else c.profile_a end as other_id,
      c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
      c.acknowledged, c.tag_keys
    from public.connections c
    where c.profile_a = (select id from me) or c.profile_b = (select id from me)
  )
  select
    m.other_id,
    p.display_name, p.first_name, p.last_name, p.preferred_name, p.status,
    m.degree, m.context_type, m.context_label, m.time_relation, m.overlap_years,
    m.acknowledged, m.tag_keys,
    -- node size. One indexed lookup per person in your graph.
    (select count(*) from public.colleagueships k
      where k.profile_a = m.other_id or k.profile_b = m.other_id) as their_degree_count,
    -- where they are now, for grouping the rings by region
    (select s.country
       from public.postings po join public.schools s on s.id = po.school_id
      where po.profile_id = m.other_id
      order by (po.end_date is null) desc, po.start_date desc
      limit 1) as home_country
  from mine m
  join public.public_profiles p on p.id = m.other_id;
$$;

revoke execute on function public.my_connections() from public, anon;
grant  execute on function public.my_connections() to authenticated;

-- ── One pair, on demand ─────────────────────────────────────────────────────
-- The person card lists every way you and one other person are connected. That
-- is a handful of rows about two people; there is no reason to hold the whole
-- shared_contexts table in a browser to find them.
create or replace function public.pair_contexts(p_other uuid)
returns table (
  degree        smallint,
  context_type  text,
  context_label text,
  time_relation text,
  overlap_years text
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.degree, s.context_type, s.context_label, s.time_relation, s.overlap_years
    from public.shared_contexts s
   where s.profile_a = least(auth.uid(), p_other)
     and s.profile_b = greatest(auth.uid(), p_other)
   order by s.degree, s.context_label;
$$;

revoke execute on function public.pair_contexts(uuid) from public, anon;
grant  execute on function public.pair_contexts(uuid) to authenticated;

-- Your own postings power the map's journey and the "where they've been" list.
create index if not exists postings_profile_start_idx
  on public.postings (profile_id, start_date desc);
