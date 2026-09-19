-- ============================================================================
-- Remember when we last emailed someone about a conversation.
--
-- Dave's design, June 2026: "perhaps they could message someone via the
-- platform which then sends a vanilla email to the recipient — 'You've received
-- a direct message on the 6 Degrees site. Log in to read it.' — without either
-- party seeing the other's email."
--
-- Without this column, ten messages in a row would send ten emails, out of an
-- allowance shared with the sign-in links that are the only way into the site.
-- One notification per conversation per half hour is a nudge; ten is a reason to
-- turn messages off.
-- ============================================================================

alter table public.conversations
  add column if not exists last_notified_at timestamptz;

-- Who to tell, and whether we already have. Service-role only: it returns an
-- email address, which nothing else in this project ever does.
create or replace function public.notify_target(p_conversation bigint, p_sender uuid)
returns table (recipient_id uuid, recipient_email text, sender_name text, should_send boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    u.email,
    (select display_name from public.profiles where id = p_sender),
    -- quiet if they switched messages off, or we told them recently
    coalesce(ps.accepts_messages, true)
      and coalesce(c.last_notified_at, 'epoch'::timestamptz) < now() - interval '30 minutes'
  from public.conversations c
  join public.profiles r
    on r.id = case when c.member_a = p_sender then c.member_b else c.member_a end
  join auth.users u on u.id = r.id
  left join public.privacy_settings ps on ps.profile_id = r.id
  where c.id = p_conversation
    and (c.member_a = p_sender or c.member_b = p_sender)
    and r.status = 'active';
$$;

revoke execute on function public.notify_target(bigint, uuid) from public, anon, authenticated;

create or replace function public.mark_notified(p_conversation bigint)
returns void
language sql security definer set search_path = public as $$
  update public.conversations set last_notified_at = now() where id = p_conversation;
$$;

revoke execute on function public.mark_notified(bigint) from public, anon, authenticated;
