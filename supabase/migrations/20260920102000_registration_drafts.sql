-- ============================================================================
-- A half-finished registration that follows you between devices.
--
-- The form already keeps a draft, but in localStorage — so it lives in ONE
-- browser. Start on the phone at school, finish on the laptop at home, and
-- there is nothing there. Clear your history and it is gone. Use a private
-- window, which plenty of people do on a shared staffroom machine, and it was
-- never saved at all.
--
-- The cost of that is not hypothetical. On the morning of 20 Sep somebody added
-- six schools between 05:15 and 05:30, was given no confirmation for any of
-- them because of a bug in the form, and stopped. They are one of fourteen
-- people who have signed in and never finished. A draft they could pick up on
-- any device is the difference between "start again" and "carry on".
--
-- The row belongs to an AUTH USER, not a profile: the people who need it are by
-- definition the ones who have no profile yet.
--
-- It holds a name and a list of postings — the same shape the form already
-- keeps locally — and it is deleted the moment registration succeeds.
-- ============================================================================

create table if not exists public.registration_drafts (
  user_id    uuid primary key references auth.users on delete cascade,
  body       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.registration_drafts enable row level security;

-- Yours and nobody else's — not even to read. `authenticated`, deliberately not
-- is_member(): requiring a profile would exclude everybody this is built for.
drop policy if exists drafts_own on public.registration_drafts;
create policy drafts_own on public.registration_drafts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.registration_drafts to authenticated;

-- One row per person, whatever the browser does.
create or replace function public.save_draft(p_body jsonb)
returns timestamptz
language plpgsql security invoker set search_path = public as $$
declare
  t timestamptz := now();
begin
  if auth.uid() is null then raise exception 'You are not signed in.'; end if;
  -- A runaway keystroke handler must not be able to fill the database.
  if length(p_body::text) > 100000 then raise exception 'That draft is too large.'; end if;
  insert into public.registration_drafts (user_id, body, updated_at)
  values (auth.uid(), p_body, t)
  on conflict (user_id) do update set body = excluded.body, updated_at = excluded.updated_at;
  return t;
end $$;

revoke execute on function public.save_draft(jsonb) from public, anon;
grant  execute on function public.save_draft(jsonb) to authenticated;
