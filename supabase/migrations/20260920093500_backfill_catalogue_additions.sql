-- ============================================================================
-- Seed the review queue with what members have already added.
--
-- The trigger only sees inserts from now on, and fifteen schools were added
-- between 13 and 20 Sep. Ten were reviewed by hand this morning and are marked
-- reviewed; the four that need the person who added them start the queue.
--
-- Cities are not backfilled: cities carry no added_by, so who typed them is not
-- recoverable. From now on the trigger records it.
-- ============================================================================

insert into public.catalogue_additions
  (created_at, kind, entity_id, name, city, region, country, country_code,
   added_by, had_profile, status, review_note, reviewed_at)
select
  s.added_at, 'school', s.id, s.name, s.city, s.region, s.country, s.country_code,
  s.added_by, exists (select 1 from public.profiles p where p.id = s.added_by),
  case when s.is_verified then 'ok' else 'new' end,
  case when s.is_verified then 'Checked against the school''s own site, 20 Sep 2026' end,
  case when s.is_verified then now() end
  from public.schools s
 where s.added_by is not null
   and not exists (select 1 from public.catalogue_additions a
                    where a.kind = 'school' and a.entity_id = s.id);
