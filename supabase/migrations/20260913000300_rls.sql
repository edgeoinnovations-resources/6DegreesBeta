-- ============================================================================
-- 6 Degrees — Row Level Security
--
-- The anon key is public: it ships to every browser. RLS is therefore the ONLY
-- thing standing between a curious visitor and this data. Every table is locked
-- by default and opened deliberately, one policy at a time.
--
-- Rules encoded here:
--   * Nothing is readable while signed out. (Paul, 13 Sep 2026: "Nothing.
--     Redirect to sign-in.")
--   * Signed-in members can see every member and the graph. ("Everyone can see
--     everyone.")
--   * Email addresses are never exposed. They live in auth.users and no policy
--     or view below reads them.
--   * Nobody can write a degree. Colleagueships are derived and have no client
--     write policy at all.
--   * A public tag needs BOTH sides. You can only approve a tag aimed at you.
-- ============================================================================

alter table public.schools           enable row level security;
alter table public.invites           enable row level security;
alter table public.profiles          enable row level security;
alter table public.privacy_settings  enable row level security;
alter table public.postings          enable row level security;
alter table public.colleagueships    enable row level security;
alter table public.notes             enable row level security;
alter table public.tag_types         enable row level security;
alter table public.connection_tags   enable row level security;
alter table public.contact_requests  enable row level security;

-- Is the caller a signed-in member with a profile? Every read depends on this.
create or replace function public.is_member()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- ── Schools: readable by members, writable by nobody through the client ─────
drop policy if exists schools_read on public.schools;
create policy schools_read on public.schools
  for select to authenticated using (public.is_member());

-- ── Invites: you may check your own invite; only members may create one ─────
drop policy if exists invites_read_own on public.invites;
create policy invites_read_own on public.invites
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_member());

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated with check (public.is_member());

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Members see everyone. A ghost still appears (so other people's degrees stay
-- intact) but the client is expected to render it anonymously; see the
-- public_profiles view below, which does that server-side rather than trusting
-- the browser to remember.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (public.is_member());

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Deliberately no delete policy: leaving means becoming a ghost, not vanishing
-- and taking everyone else's connections with you.

-- What the app should actually read. Ghosts are anonymised here, in the
-- database, so a client bug cannot leak a departed member's name.
create or replace view public.public_profiles
with (security_invoker = true) as
  select
    p.id,
    case when p.status = 'ghost' then 'Former member' else p.display_name end as display_name,
    case when p.status = 'ghost' then null else p.first_name end   as first_name,
    case when p.status = 'ghost' then null else p.last_initial end as last_initial,
    case when p.status = 'ghost' then null else p.nationality end  as nationality,
    case when p.status = 'ghost' then null else p.specialization end as specialization,
    p.status,
    p.created_at
  from public.profiles p;

-- ── Privacy settings: yours alone ───────────────────────────────────────────
drop policy if exists privacy_read_own on public.privacy_settings;
create policy privacy_read_own on public.privacy_settings
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists privacy_write_own on public.privacy_settings;
create policy privacy_write_own on public.privacy_settings
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ── Postings: members read all (that is the product), you edit only yours ───
drop policy if exists postings_read on public.postings;
create policy postings_read on public.postings
  for select to authenticated using (public.is_member());

drop policy if exists postings_write_own on public.postings;
create policy postings_write_own on public.postings
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- ── Colleagueships: read-only, always. No insert/update/delete policy. ──────
drop policy if exists colleagueships_read on public.colleagueships;
create policy colleagueships_read on public.colleagueships
  for select to authenticated using (public.is_member());

-- ── Notes: private to their author, full stop ───────────────────────────────
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes
  for all to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- ── Tag vocabulary: readable by members, fixed otherwise ────────────────────
drop policy if exists tag_types_read on public.tag_types;
create policy tag_types_read on public.tag_types
  for select to authenticated using (public.is_member());

-- ── Connection tags ─────────────────────────────────────────────────────────
-- Visible if you are either party, or if it is approved (approved tags are
-- public by design — that is the point of the approval step).
drop policy if exists tags_read on public.connection_tags;
create policy tags_read on public.connection_tags
  for select to authenticated
  using (public.is_member() and (
    status = 'approved' or requester_id = auth.uid() or subject_id = auth.uid()
  ));

-- You may only create a tag as yourself, and only as pending.
drop policy if exists tags_insert on public.connection_tags;
create policy tags_insert on public.connection_tags
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

-- Either party may update, but the allowed transitions differ and are enforced
-- by the trigger below: the SUBJECT approves or declines, the REQUESTER may
-- withdraw, and either may revoke something already approved.
drop policy if exists tags_update on public.connection_tags;
create policy tags_update on public.connection_tags
  for update to authenticated
  using (requester_id = auth.uid() or subject_id = auth.uid())
  with check (requester_id = auth.uid() or subject_id = auth.uid());

drop policy if exists tags_delete_own_pending on public.connection_tags;
create policy tags_delete_own_pending on public.connection_tags
  for delete to authenticated
  using (requester_id = auth.uid() and status = 'pending');

-- Only the person a tag points AT may approve or decline it. Without this, the
-- update policy above would let a requester approve their own tag, and "both
-- people have to agree" would be decorative.
create or replace function public.enforce_tag_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- FAIL CLOSED. auth.uid() is null when there is no JWT, and `null <> x` is
  -- null, not true -- so a naive `auth.uid() <> old.subject_id` check silently
  -- PASSES for an unauthenticated caller and "both people must agree" becomes
  -- decorative. Every branch below tests for null explicitly.
  if new.status is distinct from old.status then
    if auth.uid() is null then
      raise exception 'tag status cannot be changed without an authenticated user';
    end if;
    if new.status in ('approved','declined') and auth.uid() is distinct from old.subject_id then
      raise exception 'only the tagged person may approve or decline this tag';
    end if;
    if new.status = 'pending' and old.status <> 'pending' then
      raise exception 'a tag cannot return to pending; create a new one';
    end if;
    if new.status = 'revoked'
       and auth.uid() is distinct from old.requester_id
       and auth.uid() is distinct from old.subject_id then
      raise exception 'only the two people involved may revoke this tag';
    end if;
    new.responded_at = now();
  end if;
  -- the parties and the tag itself are immutable once created
  if new.requester_id <> old.requester_id or new.subject_id <> old.subject_id
     or new.tag_key <> old.tag_key then
    raise exception 'a tag''s parties and type cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists connection_tags_transition on public.connection_tags;
create trigger connection_tags_transition
  before update on public.connection_tags
  for each row execute function public.enforce_tag_transition();

-- ── Contact requests: between the two parties only ──────────────────────────
drop policy if exists contact_read on public.contact_requests;
create policy contact_read on public.contact_requests
  for select to authenticated
  using (requester_id = auth.uid() or subject_id = auth.uid());

drop policy if exists contact_insert on public.contact_requests;
create policy contact_insert on public.contact_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

drop policy if exists contact_update_subject on public.contact_requests;
create policy contact_update_subject on public.contact_requests
  for update to authenticated
  using (subject_id = auth.uid()) with check (subject_id = auth.uid());

-- ── Sign-up is invite only ──────────────────────────────────────────────────
-- Enforced in the database rather than the UI, so it holds however someone
-- arrives. (Dave, 6 Sep 2025: "to keep some of the bad actors that abound on our
-- planet out of 6DoIT ... new members would have to either be invited or
-- approved by those already in the system".)
create or replace function public.enforce_invite_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.invites where lower(email) = lower(new.email)) then
    raise exception 'This email has not been invited to 6 Degrees.';
  end if;
  update public.invites set accepted_at = now()
   where lower(email) = lower(new.email) and accepted_at is null;
  return new;
end $$;

drop trigger if exists enforce_invite_only_trg on auth.users;
create trigger enforce_invite_only_trg
  before insert on auth.users
  for each row execute function public.enforce_invite_only();

-- ── Lock down function execution ────────────────────────────────────────────
revoke execute on function public.recompute_all() from public, anon, authenticated;
revoke execute on function public.recompute_for_profile(uuid) from public, anon;
grant  execute on function public.recompute_for_profile(uuid) to authenticated;
