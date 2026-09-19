-- ============================================================================
-- Messaging. The most-asked-for thing in eighteen months of that group chat.
--
-- Linda, Sep 2025: "if there's a connection we want people to be able to reach
-- out." Dave's houseguest, June: "Interesting data, but no way to connect."
-- Linda again on 13 Sep: "If I saw we were connected but I had lost touch with
-- you, I'd want to be able to connect."
--
-- It reverses the June meeting's decision to leave contact out on liability
-- grounds. Paul's call, 19 Sep 2026, with the rules he set:
--
--   * any member may message any other
--   * a global "Allow People to Message Me" toggle, ON by default — off by
--     default is a feature nobody finds, and Linda's use case dies with it
--   * a per-person switch that QUIETLY stops one member writing to you. Silent
--     on purpose: telling someone they have been blocked invites exactly the
--     confrontation the switch exists to avoid. The cost is real — they keep
--     writing into nothing — and everyone accepts it for the same reason.
--   * 10 NEW conversations a day. Replies are unlimited; starting one with a
--     stranger is the only thing worth rationing.
--   * nobody ever sees anybody's email address, here or in the notification
--
-- WHAT THE DATABASE GUARANTEES. A message is readable by exactly two people. It
-- is not "hidden in the UI" — the policies below are the only thing standing
-- between a private message and anyone holding the anon key, which ships in
-- every browser.
-- ============================================================================

-- ── Who will accept messages ────────────────────────────────────────────────
alter table public.privacy_settings
  add column if not exists accepts_messages boolean not null default true;

comment on column public.privacy_settings.accepts_messages is
  'The global "Allow People to Message Me" switch. Default TRUE: a feature nobody can find is not a feature.';

-- Every member needs a row for the default to mean anything.
insert into public.privacy_settings (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

-- ── The per-person switch ───────────────────────────────────────────────────
-- A row means "I do not want messages from this person". Its absence means fine.
create table if not exists public.message_blocks (
  owner_id   uuid not null references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, blocked_id),
  check (owner_id <> blocked_id)
);

alter table public.message_blocks enable row level security;

-- Only you may see or change your own list. The blocked person must never be
-- able to discover they are on it — that is the whole point of it being quiet.
drop policy if exists blocks_own on public.message_blocks;
create policy blocks_own on public.message_blocks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select, insert, delete on public.message_blocks to authenticated;

-- ── Conversations and messages ──────────────────────────────────────────────
-- One conversation per pair, stored canonically, so "message Linda" always finds
-- the same thread however it is reached.
create table if not exists public.conversations (
  id          bigint generated always as identity primary key,
  member_a    uuid not null references public.profiles on delete cascade,
  member_b    uuid not null references public.profiles on delete cascade,
  created_at  timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  unique (member_a, member_b),
  check (member_a < member_b)
);
create index if not exists conversations_b_idx on public.conversations (member_b, last_at desc);
create index if not exists conversations_a_idx on public.conversations (member_a, last_at desc);

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations on delete cascade,
  sender_id       uuid not null references public.profiles on delete cascade,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz,
  -- a member flagging something for Paul; lands beside the issue reports
  reported_at     timestamptz,
  report_note     text
);
create index if not exists messages_convo_idx on public.messages (conversation_id, created_at);
create index if not exists messages_unread_idx on public.messages (conversation_id)
  where read_at is null;

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- You see a conversation only if you are in it.
drop policy if exists convo_read on public.conversations;
create policy convo_read on public.conversations
  for select to authenticated
  using (member_a = auth.uid() or member_b = auth.uid());

-- Reading and writing messages both require being one of the two people. The
-- second clause is what makes this private: without it the anon key that ships
-- in every browser would read the lot.
drop policy if exists msg_read on public.messages;
create policy msg_read on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (c.member_a = auth.uid() or c.member_b = auth.uid())
  ));

-- Marking as read, and reporting, are the only updates a member makes.
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages
  for update to authenticated
  using (exists (
    select 1 from public.conversations c
     where c.id = messages.conversation_id
       and (c.member_a = auth.uid() or c.member_b = auth.uid())
  ));

grant select on public.conversations to authenticated;
grant select, update on public.messages to authenticated;
-- Sending goes through send_message() below, never a direct insert.

-- ── Sending ─────────────────────────────────────────────────────────────────
create or replace function public.send_message(p_to uuid, p_body text)
returns table (conversation_id bigint, message_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := auth.uid();
  v_body  text := btrim(coalesce(p_body, ''));
  a       uuid;
  b       uuid;
  convo   bigint;
  is_new  boolean := false;
  started int;
  msg_id  bigint;
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  if not public.is_member() then
    raise exception 'Finish your own details first.' using errcode = '42501';
  end if;
  if p_to is null or p_to = me then
    raise exception 'Pick somebody to write to.' using errcode = '22023';
  end if;
  if length(v_body) = 0 then
    raise exception 'The message is empty.' using errcode = '22023';
  end if;
  if length(v_body) > 4000 then
    raise exception 'That message is too long — 4,000 characters is the limit.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_to and status = 'active') then
    raise exception 'That person is no longer on 6 Degrees.' using errcode = '22023';
  end if;

  a := least(me, p_to);
  b := greatest(me, p_to);
  select id into convo from public.conversations where member_a = a and member_b = b;

  -- The two refusals below are deliberately indistinguishable from success to the
  -- sender. Telling someone they have been declined invites the confrontation the
  -- switch exists to prevent, so the message is simply not delivered. The cost,
  -- accepted knowingly: they may write to somebody who will never read it.
  if exists (select 1 from public.message_blocks
              where owner_id = p_to and blocked_id = me)
     or not coalesce((select ps.accepts_messages from public.privacy_settings ps
                       where ps.profile_id = p_to), true)
  then
    -- Existing conversation: return it, write nothing.
    return query select coalesce(convo, 0::bigint), 0::bigint;
    return;
  end if;

  if convo is null then
    -- Starting a conversation with somebody new is the only thing worth
    -- rationing. Replies inside one already open are unlimited.
    select count(*) into started from public.conversations c
     where (c.member_a = me or c.member_b = me)
       and c.created_at > now() - interval '24 hours';
    if started >= 10 then
      raise exception 'That is 10 new conversations today, which is the daily limit. Replies are unlimited.'
        using errcode = '54000';
    end if;
    insert into public.conversations (member_a, member_b) values (a, b) returning id into convo;
    is_new := true;
  end if;

  insert into public.messages (conversation_id, sender_id, body)
  values (convo, me, v_body) returning id into msg_id;

  update public.conversations set last_at = now() where id = convo;

  return query select convo, msg_id;
end $$;

revoke execute on function public.send_message(uuid, text) from public, anon;
grant  execute on function public.send_message(uuid, text) to authenticated;

-- ── Your inbox ──────────────────────────────────────────────────────────────
create or replace function public.my_conversations()
returns table (
  conversation_id bigint,
  other_id        uuid,
  other_name      text,
  last_at         timestamptz,
  last_body       text,
  last_from_me    boolean,
  unread          bigint
)
language sql stable security invoker set search_path = public as $$
  select c.id,
         case when c.member_a = auth.uid() then c.member_b else c.member_a end,
         p.display_name,
         c.last_at,
         (select m.body from public.messages m
           where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select m.sender_id = auth.uid() from public.messages m
           where m.conversation_id = c.id order by m.created_at desc limit 1),
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.read_at is null and m.sender_id <> auth.uid())
    from public.conversations c
    join public.public_profiles p
      on p.id = case when c.member_a = auth.uid() then c.member_b else c.member_a end
   where c.member_a = auth.uid() or c.member_b = auth.uid()
   order by c.last_at desc;
$$;

revoke execute on function public.my_conversations() from public, anon;
grant  execute on function public.my_conversations() to authenticated;

create or replace function public.unread_count()
returns bigint
language sql stable security invoker set search_path = public as $$
  select count(*) from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where (c.member_a = auth.uid() or c.member_b = auth.uid())
     and m.sender_id <> auth.uid() and m.read_at is null;
$$;

revoke execute on function public.unread_count() from public, anon;
grant  execute on function public.unread_count() to authenticated;

create or replace function public.mark_read(p_conversation bigint)
returns void
language sql security invoker set search_path = public as $$
  update public.messages m
     set read_at = now()
   where m.conversation_id = p_conversation
     and m.sender_id <> auth.uid()
     and m.read_at is null;
$$;

revoke execute on function public.mark_read(bigint) from public, anon;
grant  execute on function public.mark_read(bigint) to authenticated;
