-- ============================================================================
-- Someone registering could not add their city.
--
-- Found in the error log, 20 Sep 2026: "new row violates row-level security
-- policy for table cities", from a signed-in user with NO PROFILE. That is not
-- an edge case — it is precisely the person the app should be helping. The
-- policy read `is_member()`, which asks "do you already have a profile", and
-- the city box appears while you are filling that profile in for the first
-- time. So the only people it blocked were new members.
--
-- Schools have never worked this way: schools_insert_member asks only that the
-- row is stamped with your own id and marked unverified, and any signed-in user
-- may add one. Cities are lower-risk reference data than schools, and this
-- brings them into line.
--
-- The shape checks stay, because a bad city name is a degree-3 link that never
-- forms: "Delhi" and "New Delhi" are already two places in this database.
-- ============================================================================

drop policy if exists cities_insert_member on public.cities;

create policy cities_insert_signed_in on public.cities
  for insert to authenticated
  with check (
        length(btrim(name)) between 2 and 120
    and length(btrim(country_code)) = 2
    and (latitude  is null or latitude  between  -90 and  90)
    and (longitude is null or longitude between -180 and 180)
  );
