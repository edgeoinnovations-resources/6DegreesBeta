-- ============================================================================
-- Client error log: every failure anyone hits, recorded so it can be fixed later.
--
-- Paul, 13 Sep 2026: "create a system where every single failure on the app is
-- logged on the back end so when we start working on it again, you can check and
-- fix all the errors".
--
-- Today every bug was found one screenshot at a time, often hours after it
-- happened and sometimes without the actual message. This records them as they
-- happen instead.
--
-- PRIVACY — this is real people's usage, so it is deliberately narrow:
--   * WRITE-ONLY from the app. No member can read it, including their own rows;
--     it is read with the CLI by whoever is maintaining the app.
--   * No email addresses, form contents, notes, tag text or URL tokens. The
--     client strips anything email- or token-shaped before sending, and the
--     trigger below strips it again in case a future caller forgets.
--   * Kept 90 days.
-- ============================================================================

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid default auth.uid() references auth.users on delete set null,
  build       text check (length(build) <= 60),
  view        text check (length(view) <= 40),
  action      text check (length(action) <= 80),
  code        text check (length(code) <= 40),
  message     text check (length(message) <= 1000),
  stack       text check (length(stack) <= 4000),
  path        text check (length(path) <= 200),
  user_agent  text check (length(user_agent) <= 300),
  -- set by whoever fixes it, never by the app
  resolved_at timestamptz,
  resolution  text
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
create index if not exists client_errors_open_idx on public.client_errors (resolved_at) where resolved_at is null;

alter table public.client_errors enable row level security;

-- Signed-in members may add a row, attributed to themselves, and nothing else.
drop policy if exists client_errors_insert_member on public.client_errors;
create policy client_errors_insert_member on public.client_errors
  for insert to authenticated
  with check (user_id is not distinct from auth.uid() and resolved_at is null and resolution is null);

-- Signed-OUT visitors must be able to log too: the sign-in screen is exactly where
-- the email problems happened today. Anonymous rows carry no user, and the trigger
-- caps how many can arrive per hour so the public anon key can't be used to fill
-- the database.
drop policy if exists client_errors_insert_anon on public.client_errors;
create policy client_errors_insert_anon on public.client_errors
  for insert to anon
  with check (user_id is null and resolved_at is null and resolution is null);

-- Deliberately NO select, update or delete policy. The log is write-only to the app.
grant insert on public.client_errors to anon, authenticated;

create or replace function public.client_errors_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Anonymous flood cap: the anon key is public, so bound what it can write.
  if new.user_id is null and (
       select count(*) from public.client_errors
        where user_id is null and created_at > now() - interval '1 hour'
     ) >= 200 then
    return null;            -- drop silently; the caller never learns the cap
  end if;

  -- Strip anything email- or token-shaped, even if the client already did.
  new.message := regexp_replace(coalesce(new.message, ''),
                   '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
  new.message := regexp_replace(new.message,
                   'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[token]', 'g');
  new.stack   := regexp_replace(coalesce(new.stack, ''),
                   '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
  new.path    := regexp_replace(coalesce(new.path, ''),
                   '(access_token|refresh_token|code|token)=[^&#]*', '\1=[redacted]', 'g');

  -- Retention, without needing pg_cron: occasionally sweep anything past 90 days.
  if random() < 0.02 then
    delete from public.client_errors where created_at < now() - interval '90 days';
  end if;
  return new;
end $$;

drop trigger if exists client_errors_guard_trg on public.client_errors;
create trigger client_errors_guard_trg
  before insert on public.client_errors
  for each row execute function public.client_errors_guard();

-- ── Reading it ──────────────────────────────────────────────────────────────
-- In a schema PostgREST does not expose, so no app caller can reach it at all.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create or replace view ops.error_summary as
  select
    coalesce(code, '-')                           as code,
    coalesce(action, '-')                         as action,
    left(regexp_replace(message, '\s+', ' ', 'g'), 160) as message,
    count(*)                                      as occurrences,
    count(distinct user_id)                       as people,
    count(*) filter (where user_id is null)       as signed_out,
    min(created_at)                               as first_seen,
    max(created_at)                               as last_seen,
    string_agg(distinct build, ', ')              as builds,
    string_agg(distinct view, ', ')               as views
  from public.client_errors
  where resolved_at is null
  group by 1, 2, 3
  order by max(created_at) desc;
