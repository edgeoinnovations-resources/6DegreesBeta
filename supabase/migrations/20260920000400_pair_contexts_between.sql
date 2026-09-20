-- ============================================================================
-- Every way two OTHER people are connected.
--
-- pair_contexts() answers "how am I connected to this person". Looking at
-- somebody else's graph asks a different question — "how are THEY connected to
-- this person" — and the card now shows both, so the person exploring can see
-- the link they are standing on as well as their own route in.
--
-- Discloses nothing new: both people's postings are already visible to every
-- member, and this is the arithmetic over them. Ghosts are excluded, in step
-- with a ghost not being focusable.
-- ============================================================================

create or replace function public.pair_contexts_between(p_a uuid, p_b uuid)
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
   where s.profile_a = least(p_a, p_b)
     and s.profile_b = greatest(p_a, p_b)
     and exists (select 1 from public.profiles x where x.id = p_a and x.status = 'active')
     and exists (select 1 from public.profiles y where y.id = p_b and y.status = 'active')
   order by s.degree, s.context_label;
$$;

revoke execute on function public.pair_contexts_between(uuid, uuid) from public, anon;
grant  execute on function public.pair_contexts_between(uuid, uuid) to authenticated;
