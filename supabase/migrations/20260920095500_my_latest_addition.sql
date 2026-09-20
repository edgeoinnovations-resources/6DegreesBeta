-- ============================================================================
-- The one thing a member may know about the review log: the id of what they
-- themselves just added, so the browser can ask for the email to go out.
--
-- catalogue_additions has no read policy at all, deliberately — it records who
-- is part-way through registering, which is nobody else's business. This
-- returns an id and nothing else, and only ever the caller's own.
-- ============================================================================

create or replace function public.my_latest_addition()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select id from public.catalogue_additions
   where added_by = auth.uid()
     and created_at > now() - interval '2 minutes'
   order by id desc limit 1;
$$;

revoke execute on function public.my_latest_addition() from public, anon;
grant  execute on function public.my_latest_addition() to authenticated;
