-- ============================================================================
-- A third tag type: Relative / family.
--
-- Linda, 13 Sep 2026: "Another tag- related. Both of my sisters taught
-- internationally. I worked in the same school as one." Paul: "Like, family?
-- Relative / Family ... Great idea."
--
-- Like the other two it is a mutually approved tag: it marks a connection as
-- acknowledged and never changes anyone's degree. Linda and her sister share a
-- school, so they are already a degree 1; the tag says why they also know each
-- other, which co-location alone cannot say.
-- ============================================================================

insert into public.tag_types (key, label, description, sort_order) values
  ('family', 'Relative / family',
   'You are related — family who have taught internationally.', 3)
on conflict (key) do update
  set label       = excluded.label,
      description = excluded.description,
      sort_order  = excluded.sort_order;
