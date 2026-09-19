-- ============================================================================
-- Let someone re-send an invitation they already sent.
--
-- Without this there is no way to email an invitation that exists but was never
-- delivered — and there are already such rows: everything added between the
-- invite panel shipping (18 Sep 17:39) and the sender shipping (19 Sep 14:26)
-- was recorded and never emailed. Pressing Send again just answers
-- ALREADY_LISTED, which is true and useless.
--
-- It is also what a person expects from typing an address a second time: send it
-- again, not tell me I already tried.
--
-- The guard is ownership. You may re-send only an invitation YOU sent, and only
-- while the person has not finished registering — there is no reason to email
-- somebody who is already in, and letting one member re-send another member's
-- invitation would turn this into a way to mail people repeatedly.
-- ============================================================================

create or replace function public.may_resend_invite(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.invites i
     where i.invited_by = auth.uid()
       and lower(i.email) = lower(btrim(coalesce(p_email, '')))
       and not exists (
         select 1 from auth.users u
           join public.profiles p on p.id = u.id
          where lower(u.email) = lower(i.email)
       )
  );
$$;

revoke execute on function public.may_resend_invite(text) from public, anon;
grant  execute on function public.may_resend_invite(text) to authenticated;
