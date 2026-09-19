-- ============================================================================
-- "Joined" should mean joined.
--
-- enforce_invite_only() fires BEFORE INSERT on auth.users and stamps
-- invites.accepted_at there. That was accurate enough while the only way an
-- auth user appeared was somebody clicking their own sign-in link — but it has
-- always meant "clicked a link once", not "filled in their history". Someone who
-- signs in and abandons the form has shown as accepted since day one.
--
-- Sending invitations from inside the app makes it plainly wrong: the admin API
-- creates the auth user at the moment the email is SENT, so every invitation
-- would read "Joined" before the recipient had opened it.
--
-- So my_invites() now reports three honest states instead of two:
--   invited      — the email has gone, nothing has happened
--   signed_in_at — they clicked a link (what accepted_at actually recorded)
--   registered   — a profile exists, i.e. they are really in the network
--
-- SECURITY DEFINER because deciding "registered" means reading auth.users, which
-- members cannot do. The function still returns only rows the caller sent, and
-- still returns no email address that the caller did not type in themselves.
-- ============================================================================

drop function if exists public.my_invites();

create function public.my_invites()
returns table (
  email        text,
  note         text,
  created_at   timestamptz,
  signed_in_at timestamptz,
  registered   boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.email,
    i.note,
    i.created_at,
    i.accepted_at as signed_in_at,
    exists (
      select 1
        from auth.users u
        join public.profiles p on p.id = u.id
       where lower(u.email) = lower(i.email)
    ) as registered
  from public.invites i
  where i.invited_by = auth.uid()
  order by i.created_at desc;
$$;

revoke execute on function public.my_invites() from public, anon;
grant  execute on function public.my_invites() to authenticated;
