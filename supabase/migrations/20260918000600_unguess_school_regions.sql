-- ============================================================================
-- Undo a backfill I should not have written, and put Linda's school in Minnesota.
--
-- 20260918000400 tried to be helpful: where a school's city name was unambiguous
-- in the gazetteer, it copied that city's region onto the school. Applied to real
-- data it did the precise opposite of what the migration was for.
--
-- "Annandale" IS unambiguous in GeoNames — there is exactly one, in Virginia.
-- Annandale, Minnesota has about 3,300 people and is below the threshold. So the
-- backfill read "only one Annandale exists" and stamped Linda's school region=VA.
-- Before the backfill her school's region was unknown, which is harmless because
-- an unknown region matches anything. After it, the database positively asserted
-- that Linda taught in Virginia — the exact claim she reported as the bug.
--
-- "Unambiguous in the gazetteer" is not "unambiguous in the world", and no rule
-- written from a desk can tell the difference. A region is a fact about where
-- someone worked, so it gets set when a person says so and not before.
--
-- Nothing is lost by clearing it: an unknown region matches any region, so every
-- existing connection stands. What changes is that the app stops claiming to know
-- something it guessed.
-- ============================================================================

-- Every region on a school at this point came from that backfill: the picker that
-- sets one from a human choice ships in the same release as this migration.
update public.schools set region = null where region is not null;

-- ── Linda's school ──────────────────────────────────────────────────────────
-- Linda, 13 Sep 2026: "I worked in Annandale, MN, but it puts me in Annandale,
-- VA." Her own words about her own posting, so this is recorded rather than
-- inferred. The coordinates are the centre of Minnesota, not of the town: the
-- town is not in the gazetteer, and a point in the right state beats a precise
-- point in the wrong one. Degrees come from city names, never coordinates.
insert into public.cities (name, country_code, admin1, region, latitude, longitude, population)
select 'Annandale', 'US', 'MN', 'MN', r.latitude, r.longitude, 0
  from public.regions r
 where r.country_code = 'US' and r.code = 'MN'
   and not exists (select 1 from public.cities c
                    where c.country_code = 'US' and c.name = 'Annandale' and c.region = 'MN');

update public.schools s
   set region      = 'MN',
       latitude    = c.latitude,
       longitude   = c.longitude,
       city_source = 'manual'
  from public.cities c
 where c.country_code = 'US' and c.name = 'Annandale' and c.region = 'MN'
   and s.country = 'United States'
   and s.city = 'Annandale'
   and s.name = 'Annandale Public Schools';
