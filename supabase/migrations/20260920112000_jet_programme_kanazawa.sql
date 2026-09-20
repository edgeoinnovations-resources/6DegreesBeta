-- ============================================================================
-- "JET Program" becomes "JET Programme — Kanazawa".
--
-- Linda entered it on 13 Sep as her first posting, 1990–1992, and Robb entered
-- the same thing. They were both there, together, and the degree 1 between them
-- is CORRECT — so the entry stays. This is not a school that should be merged
-- away.
--
-- The Japan Exchange and Teaching Programme places participants with a local
-- government, which assigns them across several schools in one locality. So
-- "the programme, in this place" is an honest description of the job, in a way
-- that naming one school would not be: a JET often teaches in four.
--
-- WHAT IS WRONG IS THE MISSING PLACE. As it stood, a JET who taught in Osaka in
-- 2015 would find "JET Program" in the list, pick it, and come out at degree 1
-- with Linda and Robb — same school, same time — having never been within three
-- hundred miles of them. Twenty-five years of JET alumni are a plausible slice
-- of this membership, so that is a matter of time rather than bad luck.
--
-- With the city in the name, the next JET adds their own city's entry and the
-- two groups meet where they actually meet: same country, different city.
--
-- "Programme" is the official spelling, and the acronym still finds it — the
-- school search matches JET inside the name as well as by initials.
-- ============================================================================

update public.schools
   set name = 'JET Programme — Kanazawa', is_verified = true
 where id = 2142 and name = 'JET Program';

update public.catalogue_additions
   set status = 'corrected', reviewed_at = now(),
       review_note = 'Kept: Linda and Robb were both on JET in Kanazawa 1990-92 and their '
                  || 'degree 1 is real. Renamed to carry the city, so a JET from another '
                  || 'town cannot pick it and inherit their connection.'
 where kind = 'school' and entity_id = 2142;
