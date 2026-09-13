-- ============================================================================
-- 6 Degrees — core schema
--
-- Decisions this encodes (from the team, 13 Sep 2026):
--   * Sign-in is email magic link, INVITE ONLY. Nothing is visible signed out.
--   * This holds REAL data about real people. Every table has RLS.
--   * Everyone can see everyone, but each person controls their own contact
--     visibility, and email addresses are never exposed to anyone.
--   * The six degrees are FIXED and derived from place + time. Nothing a user
--     types can change a degree.
--   * Leaving does not delete you: you become a ghost, so other people's
--     connections stay intact ("the asymmetry of leaving", June meeting).
-- ============================================================================

-- ── Reference: schools ──────────────────────────────────────────────────────
-- Geography comes from the International Schools Review lists. ISR gives country
-- and school name only and never states the city, so city_source records how each
-- city was determined and how far to trust it.
create table if not exists public.schools (
  id            bigint generated always as identity primary key,
  name          text not null,
  city          text,
  country       text not null,
  country_code  text,
  latitude      double precision,
  longitude     double precision,
  city_source   text check (city_source in ('name','fuzzy','fallback-largest-city','manual')),
  is_verified   boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (name, country)
);
create index if not exists schools_country_city_idx on public.schools (country, city);
create index if not exists schools_name_idx on public.schools (lower(name));

-- ── Invites: the allowlist that makes sign-up invite-only ───────────────────
create table if not exists public.invites (
  email        text primary key,
  invited_by   uuid references auth.users on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

-- ── Profiles: one row per signed-in person ──────────────────────────────────
-- NOTE: no email column. Auth holds the address; the app never reads it and no
-- policy below ever exposes it. (June meeting: "I don't think we should be in the
-- business of sharing anybody's email address with anybody.")
create table if not exists public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  first_name      text not null,
  last_initial    text,
  display_name    text generated always as (
                    first_name || case
                      when last_initial is null or last_initial = '' then ''
                      else ' ' || upper(left(last_initial, 1)) || '.'
                    end
                  ) stored,
  nationality     text,
  specialization  text,
  -- 'active' | 'ghost'. A ghost has left: their name is withheld but their
  -- postings remain so everyone else's degrees stay correct.
  status          text not null default 'active' check (status in ('active','ghost')),
  ghosted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Privacy settings: one row per profile, defaults lean private ────────────
create table if not exists public.privacy_settings (
  profile_id           uuid primary key references public.profiles on delete cascade,
  -- who may ASK for your contact details (the app never shows them outright)
  contact_requests     text not null default '1st'
                       check (contact_requests in ('1st','1st-2nd','all','nobody')),
  show_current_school  boolean not null default true,
  discoverable         boolean not null default true,
  updated_at           timestamptz not null default now()
);

-- ── Postings: where someone was, and when ───────────────────────────────────
create table if not exists public.postings (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles on delete cascade,
  school_id   bigint not null references public.schools on delete restrict,
  -- Linda, 7 Jun 2026: basics only — no job titles, no subjects, no grade levels.
  role        text not null default 'Faculty'
              check (role in ('Student','Faculty','Staff','Administrator')),
  start_date  date not null,
  end_date    date,                      -- null = still there
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists postings_profile_idx on public.postings (profile_id);
create index if not exists postings_school_idx  on public.postings (school_id);

-- ── Colleagueships: DERIVED. Never written by a client. ─────────────────────
--   1 same school, same time        4 same city,    different time
--   2 same school, different time   5 same country, same time
--   3 same city,   same time        6 same country, different time
-- The strongest (lowest) relationship across all posting pairs wins.
create table if not exists public.colleagueships (
  profile_a     uuid not null references public.profiles on delete cascade,
  profile_b     uuid not null references public.profiles on delete cascade,
  degree        smallint not null check (degree between 1 and 6),
  context_type  text check (context_type in ('school','city','country')),
  context_label text,
  time_relation text check (time_relation in ('same time','different time')),
  overlap_years text,
  computed_at   timestamptz not null default now(),
  primary key (profile_a, profile_b),
  -- store each pair once, canonically ordered
  check (profile_a < profile_b)
);
create index if not exists colleagueships_b_idx on public.colleagueships (profile_b);

-- ── Private notes: free text, visible ONLY to their author ──────────────────
create table if not exists public.notes (
  id          bigint generated always as identity primary key,
  author_id   uuid not null references public.profiles on delete cascade,
  subject_id  uuid not null references public.profiles on delete cascade,
  body        text not null check (length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (author_id <> subject_id)
);
create index if not exists notes_author_idx on public.notes (author_id);

-- ── Public tags: curated vocabulary, mutual approval ────────────────────────
-- Free text is deliberately NOT allowed here. Paul, 13 Sep 2026: an uncurated
-- public tag lets someone label you "TOXIC A-Hole from Barcelona IB Training"
-- for everyone to see.
create table if not exists public.tag_types (
  key         text primary key,
  label       text not null,
  description text,
  sort_order  int not null default 0
);

insert into public.tag_types (key, label, description, sort_order) values
  ('social', 'Social connection',
   'You know each other socially — friends, family, people you spend time with.', 1),
  ('professional_development', 'Professional development connection',
   'You met through professional work — a conference, training, workshop or committee.', 2)
on conflict (key) do nothing;

-- A tag is a REQUEST until the other person approves it. Only approved tags are
-- public, and either side can revoke later.
create table if not exists public.connection_tags (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references public.profiles on delete cascade,
  subject_id    uuid not null references public.profiles on delete cascade,
  tag_key       text not null references public.tag_types on delete restrict,
  status        text not null default 'pending'
                check (status in ('pending','approved','declined','revoked')),
  -- optional context ("met at the IB Global Conference 2026"). Visible to the two
  -- people involved always, and publicly only once approved.
  context       text check (context is null or length(btrim(context)) <= 200),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  updated_at    timestamptz not null default now(),
  check (requester_id <> subject_id),
  unique (requester_id, subject_id, tag_key)
);
create index if not exists connection_tags_subject_idx   on public.connection_tags (subject_id, status);
create index if not exists connection_tags_requester_idx on public.connection_tags (requester_id, status);

-- ── Contact requests: ask, don't expose ─────────────────────────────────────
-- Kept minimal on purpose. The June meeting put actual messaging out of scope;
-- this only records that an ask happened and what the answer was.
create table if not exists public.contact_requests (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references public.profiles on delete cascade,
  subject_id    uuid not null references public.profiles on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending','approved','declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (requester_id <> subject_id),
  unique (requester_id, subject_id)
);

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','privacy_settings','postings','notes','connection_tags']
  loop
    execute format(
      'drop trigger if exists %I_touch on public.%I; '
      'create trigger %I_touch before update on public.%I '
      'for each row execute function public.touch_updated_at();',
      t, t, t, t);
  end loop;
end $$;
