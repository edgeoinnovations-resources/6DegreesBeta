-- ============================================================================
-- Review of the 14 member-added schools (CLAUDE.md §5), 20 Sep 2026.
--
-- Checked each for spelling, city, and near-duplicates. A fuzzy scan of all
-- 2,134 schools found NO duplicate of any of them — the only near-match was
-- "JET Program" against "Jet International School" in Mongolia, which is an
-- artefact of ignoring common words, not a duplicate.
--
-- TWO NAMES CORRECTED, both against the schools' own sites and Wikipedia:
--   2140  "Indian Trail Academy"          -> "Indian Trail High School and Academy"
--         Kenosha, Wisconsin. The Academy became the comprehensive school in
--         2011; Dave may well have known it under the old name, and the row has
--         no postings attached, so nothing in anybody's history moves.
--   2148  "Buckingham Brown and Nichols"  -> "Buckingham Browne & Nichols School"
--         Cambridge, Massachusetts. Browne has an e.
--
-- THREE US STATES FILLED IN, each verified for that named school rather than
-- inferred from a gazetteer — which is the mistake that once stamped Linda's
-- school as Virginia:
--   2140 Kenosha WI · 2147 Goose Creek SC · 2153 Palo Alto CA
-- A null region matches anything in pair_degree, so these only make the city
-- links stricter; they can never remove a true one.
--
-- NOT VERIFIED, four rows that need the member who added them:
--   2139  John Marshall High School, Rochester — Rochester MN and Rochester NY
--         both have one. Ask Dave which.
--   2142  JET Program, Kanazawa — the Japan Exchange and Teaching programme, a
--         placement rather than a school. Linda has two postings on it. Works,
--         but it is not what the catalogue is for.
--   2144  Aylesbury State School, Aylesbury, UNITED KINGDOM — no school of that
--         name found in the UK, and "State School" is Australian usage, not
--         British. Dee also added two Australian and Canadian schools.
--   2154  Sogang Language Program, Daejeon — Sogang's Korean Language Education
--         Centre is in SEOUL. If the city is wrong it is a wrong degree 3.
-- ============================================================================

update public.schools set name = 'Indian Trail High School and Academy', region = 'WI'
 where id = 2140 and name = 'Indian Trail Academy';

update public.schools set name = 'Buckingham Browne & Nichols School'
 where id = 2148 and name = 'Buckingham Brown and Nichols';

update public.schools set region = 'SC' where id = 2147 and region is null;
update public.schools set region = 'CA' where id = 2153 and region is null;

update public.schools set is_verified = true
 where id in (2140, 2143, 2145, 2146, 2147, 2148, 2149, 2151, 2152, 2153);
