-- ============================================================================
-- Security hardening from `supabase db advisors --type security` (13 Sep 2026).
--
-- 1. A LEFTOVER DIAGNOSTIC. public._diag() was created by hand while debugging the
--    registration RLS error and never dropped. Removed.
--
-- 2. EXECUTE WAS STILL GRANTED TO PUBLIC. 20260913000500 revoked function access
--    from `anon`, but Postgres grants EXECUTE on new functions to PUBLIC by default,
--    and anon inherits from PUBLIC — so the revoke did nothing. Every SECURITY
--    DEFINER function was reachable at /rest/v1/rpc/<name> by anyone. The trigger
--    functions fail if called directly (they return `trigger`), so there was no
--    working exploit, but nothing internal should be exposed at all.
--
-- 3. recompute_for_profile() was deliberately granted to members. They never need
--    it — triggers call it as the definer — and it let any member force a
--    recompute of anyone's connections. Revoked.
--
-- Deliberately KEPT for signed-in members:
--   save_my_profile, ghost_me   — the app calls these
--   is_member                   — RLS policies call it as the querying role
--
-- Not addressed: "leaked password protection" — sign-in is magic link only, there
-- are no passwords. rls_auto_enable() is Supabase-managed, not ours.
-- ============================================================================

drop function if exists public._diag();

-- Nothing in public is callable by default any more; grant back only what is used.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

grant execute on function public.save_my_profile(text, text, text, text, jsonb) to authenticated;
grant execute on function public.ghost_me()                                     to authenticated;
grant execute on function public.is_member()                                    to authenticated;

-- Immutable helpers used inside views/policies as the querying role.
grant execute on function public.school_name_key(text)                          to authenticated;
grant execute on function public.ranges_overlap(date, date, date, date)         to authenticated;
grant execute on function public.overlap_years(date, date, date, date)          to authenticated;

-- Pin search_path on the functions that didn't have one, so a hostile object on
-- the search path can't be substituted into them.
alter function public.ranges_overlap(date, date, date, date) set search_path = public;
alter function public.overlap_years(date, date, date, date)  set search_path = public;
alter function public.touch_updated_at()                      set search_path = public;
alter function public.school_name_key(text)                   set search_path = public;
alter function public.pair_degree(bigint, text, text, date, date, bigint, text, text, date, date)
  set search_path = public;
