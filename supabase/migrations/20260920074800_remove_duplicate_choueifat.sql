-- ============================================================================
-- Remove a duplicate school: "International School of Choueifat, Lahore".
--
-- Added by a member on 20 Sep 2026 and filed under Choueifat, LEBANON — the
-- town in Lebanon the SABIS network is named after, not where the school is.
-- The school itself was already here: id 1355, "International School
-- Choueifat", Lahore, Pakistan, verified and geocoded.
--
-- The two names differ only by a trailing ", Lahore", so school_name_key() does
-- not see them as the same and neither the dedupe trigger nor the health check
-- would ever have flagged them. Left alone, two colleagues picking different
-- rows compute as degree 3 — same city — instead of degree 1. That is the
-- quietest way this database can be wrong about the thing it exists to say.
--
-- Safe to remove: NO postings reference it. Checked immediately before, and
-- guarded again below. The person who added it never got it attached to their
-- history, because the form threw on a missing variable the moment the row was
-- created (fixed in build 20 Sep 06:01 UTC).
--
-- Paul agreed to the deletion, 20 Sep 2026, having been shown both rows.
-- ============================================================================

do $$
declare
  n integer;
begin
  select count(*) into n from public.postings where school_id = 2150;
  if n > 0 then
    raise exception 'school 2150 now has % posting(s) — not deleting', n;
  end if;

  delete from public.schools
   where id = 2150
     and name = 'International School of Choueifat, Lahore'
     and country = 'Lebanon';

  if not found then
    raise notice 'school 2150 was not there to delete — nothing done';
  end if;
end $$;
