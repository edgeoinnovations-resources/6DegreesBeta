-- ============================================================================
-- A school somebody added was treated as having an unknown city.
--
-- CLAUDE.md has said since the geocoding pass that "a member-added school
-- counts as high: they worked there". The client never set city_confidence, so
-- every school added through the form carried NULL, and degrees 3 and 4 need
-- BOTH schools to be high or medium. Seven schools were added on the morning of
-- 20 Sep 2026 and every one of them was invisible to a same-city link — two
-- people in Palo Alto would have come out as degree 5, same country.
--
-- The evidence is as strong as this database gets: the city was chosen from the
-- gazetteer (that is where the coordinates on the row come from) by the person
-- who worked at the school.
--
-- NOT included: school 2150, "International School of Choueifat, Lahore",
-- filed under Choueifat, LEBANON. Its city is wrong, and it duplicates school
-- 1355, "International School Choueifat" in Lahore, Pakistan — already verified
-- and geocoded. Confirming a wrong city is worse than leaving it unknown, so it
-- keeps NULL until Paul says what to do with the row. It has no postings.
-- ============================================================================

update public.schools
   set city_confidence = 'high'
 where added_by is not null
   and city_source = 'manual'
   and city_confidence is null
   and city is not null
   and id <> 2150;
