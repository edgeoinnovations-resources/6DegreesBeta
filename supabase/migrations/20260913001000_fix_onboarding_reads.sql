-- ============================================================================
-- FIX: you could not register, because registering needed data you could not read.
--
-- `schools_read` required public.is_member(), which is true only once you have a
-- row in public.profiles. But the whole point of the onboarding form is that you
-- do NOT have one yet — so the country dropdown came back empty and there was no
-- way to create a profile at all. A signed-in user with no profile was locked out
-- of the only screen available to them.
--
-- Schools and tag types are reference data. There is nothing private about a list
-- of international schools: it came from a public web page. Both are now readable
-- by any AUTHENTICATED user, member or not. Everything about PEOPLE still requires
-- membership.
-- ============================================================================

drop policy if exists schools_read on public.schools;
create policy schools_read on public.schools
  for select to authenticated using (true);

drop policy if exists tag_types_read on public.tag_types;
create policy tag_types_read on public.tag_types
  for select to authenticated using (true);

-- Still nothing for anonymous callers: the grant was revoked from anon in
-- 20260913000500 and is not restored here.
