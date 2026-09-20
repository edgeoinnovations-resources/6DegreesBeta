-- ============================================================================
-- Ursuline College Chatham is in Chatham, ONTARIO.
--
-- Confirmed by Paul, 20 Sep 2026. Dee added the school on 14 Sep, before the
-- province step existed and when `regions` held nothing but American states, so
-- it was saved with a bare city name and no province.
--
-- Not a guess, and deliberately not backfilled by machine: the school's own
-- coordinates are 42.41224, -82.18494, which are Chatham, Ontario's to five
-- decimal places, and a human has now said so. The last time a region was
-- inferred from a gazetteer rather than from a person, Linda's school was
-- stamped Virginia — "unambiguous in the gazetteer" is not "unambiguous in the
-- world", and there is a Chatham in New Brunswick too.
--
-- What it changes: nothing today, because nobody else here has worked in
-- Ontario. What it prevents is the next person who has. Chatham is one of four
-- Canadian city names that also exist elsewhere in this database — London,
-- Windsor, Hamilton and Victoria are the others — and without a province the
-- only thing keeping Chatham, Ontario apart from another Chatham is the
-- country.
--
-- The trigger on `schools` re-runs the degrees for everyone affected.
-- ============================================================================

update public.schools
   set region = 'ON'
 where id = 2145
   and name = 'Ursuline College Chatham'
   and city = 'Chatham'
   and country = 'Canada'
   and region is null;

do $$
declare rg text;
begin
  select region into rg from public.schools where id = 2145;
  if rg is distinct from 'ON' then
    raise exception 'Ursuline College Chatham still has region %', coalesce(rg, 'null');
  end if;
end $$;
