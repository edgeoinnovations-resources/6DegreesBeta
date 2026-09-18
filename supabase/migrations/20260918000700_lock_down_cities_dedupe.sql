-- ============================================================================
-- cities_dedupe() was left callable by anon. My omission, same day.
--
-- 20260913001800 established the rule: nothing in the public schema is callable
-- by default, and EXECUTE is granted back only to the roles that use it. It did
-- that with a blanket revoke, which of course only covered the functions that
-- existed then. cities_dedupe() was created in 20260918000400 and picked up
-- Postgres's default grant of EXECUTE to PUBLIC, which anon inherits.
--
-- There is no working exploit — it returns `trigger`, so calling it through
-- PostgREST fails before it does anything — but it is exactly the exposure that
-- migration set out to remove, and it showed up as a new security advisor finding
-- within minutes of the push.
--
-- Also revoking pair_degree from authenticated. I granted it in 20260918000400
-- out of habit when changing its signature; nothing calls it as the querying
-- role. recompute_for_profile is SECURITY DEFINER and calls it as the definer,
-- and no view or policy references it. Grant only what is used.
-- ============================================================================

revoke execute on function public.cities_dedupe() from public, anon, authenticated;

revoke execute on function public.pair_degree(
  bigint, text, text, text, date, date, bigint, text, text, text, date, date
) from public, anon, authenticated;
