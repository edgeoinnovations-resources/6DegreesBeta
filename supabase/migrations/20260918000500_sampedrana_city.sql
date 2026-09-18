-- ============================================================================
-- Escuela Internacional de Sampedrana is in San Pedro Sula, not Tegucigalpa.
--
-- Dave, 13 Sep 2026: "What if the database has a school in the wrong city? We
-- taught for a year at the Escuela Internacional Sampedrana in San Pedro Sula,
-- Honduras, but the database lists it as being in Tegucigalpa." He taught there;
-- the name says it; the correction is not in doubt.
--
-- HOW IT GOT THERE, because this is not a one-off. The ISR source list never
-- states a city. Where the city could not be read out of the school's own name,
-- the importer fell back to the largest city in the country — and recorded that
-- honestly as city_source = 'fallback-largest-city'. That is 1,181 of 2,120
-- schools, and in Honduras it put nine of eleven schools in Tegucigalpa.
--
-- This migration fixes only the one school Dave confirmed. The other 1,180 are
-- not guesses anyone should make from a desk: the fix is to let members correct
-- the school they actually worked at, which is Dave's own suggestion and is
-- recorded in CLAUDE.md as an open item.
--
-- Changing a school's city changes who counts as "same city", so the trigger
-- added in 20260918000400 recomputes everyone affected. Nobody currently has a
-- posting here, so no degree moves today.
-- ============================================================================

update public.schools
   set city        = 'San Pedro Sula',
       latitude    = 15.5059,
       longitude   = -88.0259,
       city_source = 'manual',
       is_verified = true
 where country = 'Honduras'
   and name = 'Escuela Internacional de Sampedrana';
