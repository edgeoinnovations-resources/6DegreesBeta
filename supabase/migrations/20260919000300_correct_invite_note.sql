-- ============================================================================
-- Correcting something I asserted in 20260919000100 and got wrong.
--
-- That migration's header says the admin invite API "creates the auth user at
-- the moment the email is SENT, so every invitation would read Joined before the
-- recipient had opened it." Liz's invitation on 19 Sep proves otherwise: she
-- received the email and auth.users still holds seven rows, none of them hers,
-- and none marked invited_at. No user is created until someone actually signs in.
--
-- The migration itself stands — "Joined" meaning "clicked a link once" was
-- always wrong for anyone who signed in and abandoned the form, and registered =
-- a profile exists is the truthful test. But the urgency I attached to it was
-- based on behaviour this project does not exhibit, and migration headers are
-- what a later session reads to understand why things are the way they are.
-- Leaving a false premise in one would be worse than the original imprecision.
-- ============================================================================

comment on function public.my_invites() is
  'Invitations the caller sent, with three states: invited (email sent), '
  'signed_in_at (they clicked a link), registered (a profile exists). '
  'Note: the admin invite API does NOT create an auth.users row when the email '
  'is sent — verified 19 Sep 2026 — so a freshly sent invitation correctly reads '
  'as invited, not joined.';
