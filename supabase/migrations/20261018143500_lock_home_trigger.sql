-- ============================================================================
-- Nobody calls a trigger function by hand.
--
-- profiles_home_recompute() was created this afternoon and, like every function
-- here, came out executable by anyone with the anon key. The security advisor
-- flagged it within the hour. A trigger fires with the table's privileges and
-- never needs the caller to be allowed to execute it, so the grant does nothing
-- useful and is withdrawn — the same treatment postings_recompute() had.
-- ============================================================================
revoke execute on function public.profiles_home_recompute() from public, anon, authenticated;
