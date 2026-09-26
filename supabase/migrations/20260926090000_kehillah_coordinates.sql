-- ============================================================================
-- The Kehillah School had no coordinates, so the map drew it off Ghana.
--
-- Paul, 26 Sep 2026: RM Pellant's Palo Alto school "shows off the coast of
-- Ghana in Africa". That is 0°N 0°E — Null Island, the Gulf of Guinea — which
-- is where a missing coordinate lands when something treats null as a number.
--
-- HOW IT GOT NO COORDINATES. When a member adds a school, its point is copied
-- from the city they picked, matched on BOTH name and region:
--
--     cities.find(c => c.name === chosen && (c.region || '') === rg)
--
-- `rg` came from the option they selected, and that option had been built from
-- a school already in Palo Alto — International School of the Peninsula, whose
-- region is null. So rg was '', the gazetteer's Palo Alto is 'CA', the match
-- failed, and the insert stored null rather than refusing.
--
-- The state step added on 20 Sep closes that path: the option now carries the
-- state the member chose, which is the same value the gazetteer row has. This
-- fixes the one row created before it.
--
-- 37.44188, -122.14302 is Palo Alto's own point in the gazetteer, and the same
-- point the other school in that city already uses.
-- ============================================================================

update public.schools
   set latitude = 37.44188, longitude = -122.14302
 where id = 2153
   and name = 'The Kehillah School'
   and city = 'Palo Alto'
   and latitude is null;

do $$
declare n integer;
begin
  select count(*) into n from public.schools
   where latitude is null or longitude is null
      or (abs(latitude) < 0.0001 and abs(longitude) < 0.0001);
  if n > 0 then
    raise exception '% school(s) still have no usable coordinates', n;
  end if;
end $$;
