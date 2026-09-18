-- ============================================================================
-- Members can invite people, without being able to read each other's email.
--
-- Dave, 6 Sep 2025: "to keep some of the bad actors that abound on our planet out
-- of 6DoIT, we will probably want to have some sort of system where new members
-- would have to either be invited or approved by those already in the system."
-- That system has existed since the first schema — every sign-in is checked
-- against public.invites — but only Paul could add a row, by hand, in SQL. Every
-- member so far cost him a round trip in WhatsApp, and on 13 Sep it cost him an
-- afternoon.
--
-- A SECURITY LEAK, FIXED HERE. The read policy said:
--     using (lower(email) = own email OR public.is_member())
-- The second clause let ANY member select the whole table — every invited address
-- in the project. Paul told the group "Nobody ever sees your email address — not
-- even me", and that was not true of anyone who ran one query. It was latent
-- because no screen showed it; building an invite screen would have made it
-- trivial. A member now sees their own invite and the invites they sent, nothing
-- else.
--
-- Invites do NOT send email. Supabase's sender is wired for magic links only, and
-- the June meeting put in-app messaging out of scope. Adding someone here means
-- "this address may now sign in"; telling them is still a human job. The client
-- hands the inviter a message to send.
-- ============================================================================

-- ── Who may read what ───────────────────────────────────────────────────────
drop policy if exists invites_read_own on public.invites;
create policy invites_read_own on public.invites
  for select to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))   -- my own invite
    or invited_by = auth.uid()                                    -- ones I sent
  );

-- Direct inserts are no longer how this is done: invite_someone() below validates
-- and rate-limits, and records who did it.
drop policy if exists invites_insert on public.invites;

-- ── Inviting ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the caller must NOT be able to read the table to find
-- out whether an address is already present. The function answers that question
-- and nothing more.
create or replace function public.invite_someone(p_email text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid := auth.uid();
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  recent   int;
  total    int;
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  if not public.is_member() then
    raise exception 'Finish your own details before inviting anyone.' using errcode = '42501';
  end if;

  -- Deliberately loose: real addresses are stranger than any regex, and a typo
  -- costs nothing here (the row just never gets used).
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'That does not look like an email address.' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters.' using errcode = '22023';
  end if;

  -- A cap, so one account cannot quietly turn an invite-only network into an open
  -- one. Generous enough that nobody inviting real colleagues will meet it.
  select count(*) into recent from public.invites
   where invited_by = me and created_at > now() - interval '24 hours';
  if recent >= 25 then
    raise exception 'That is 25 invitations today — the daily limit. Try again tomorrow.'
      using errcode = '54000';
  end if;
  select count(*) into total from public.invites where invited_by = me;
  if total >= 250 then
    raise exception 'You have reached 250 invitations. Ask Paul if you need more.'
      using errcode = '54000';
  end if;

  -- "Already on the list" covers both an existing invite and an existing member,
  -- on purpose: distinguishing them would tell the caller whether a given person
  -- has an account here.
  if exists (select 1 from public.invites where lower(email) = v_email) then
    return 'ALREADY_LISTED';
  end if;

  insert into public.invites (email, invited_by, note) values (v_email, me, v_note);
  return 'INVITED';
end $$;

revoke execute on function public.invite_someone(text, text) from public, anon;
grant  execute on function public.invite_someone(text, text) to authenticated;

-- ── Seeing what you sent ────────────────────────────────────────────────────
-- A plain view over the policy above would work, but this keeps the shape stable
-- and spells out that only your own invitations come back.
create or replace function public.my_invites()
returns table (email text, note text, created_at timestamptz, accepted_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select i.email, i.note, i.created_at, i.accepted_at
    from public.invites i
   where i.invited_by = auth.uid()
   order by i.created_at desc;
$$;

revoke execute on function public.my_invites() from public, anon;
grant  execute on function public.my_invites() to authenticated;

-- Withdrawing an invitation that has not been used yet.
create or replace function public.uninvite(p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  delete from public.invites
   where invited_by = me
     and lower(email) = lower(btrim(coalesce(p_email, '')))
     and accepted_at is null;          -- never revoke someone who already joined
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function public.uninvite(text) from public, anon;
grant  execute on function public.uninvite(text) to authenticated;
