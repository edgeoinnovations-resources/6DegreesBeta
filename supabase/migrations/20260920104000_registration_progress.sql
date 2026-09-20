-- ============================================================================
-- Where people stop.
--
-- On 20 Sep 2026 fourteen people had signed in and never finished registering.
-- The only reason anybody knew is that a session counted rows by hand, and the
-- only reason the CAUSES were found is that two of them happened to leave
-- wreckage: five orphaned schools, and one row-level-security error at 01:54.
-- The other twelve left nothing at all. A funnel that has to be reconstructed
-- from wreckage is not a funnel.
--
-- Six steps, and only the FURTHEST is kept. Not an event log: the question is
-- "how far did this person get before they gave up", and one row per person
-- answers it without accumulating a trail of everything they did.
--
--   1 opened      the form is on screen
--   2 named       they typed their name
--   3 school      they picked or added their first school
--   4 dated       that posting has a start date
--   5 saving      they pressed the button
--   6 done        the profile exists
--
-- Nothing here identifies a person to anybody but Paul: there is no read policy
-- at all, and tools/funnel.sh reads it with the service key and masks emails.
-- ============================================================================

create table if not exists public.registration_progress (
  user_id    uuid primary key references auth.users on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  furthest   smallint not null default 1,
  step_name  text not null default 'opened'
);

alter table public.registration_progress enable row level security;
-- No policy: members neither read nor write this directly.

create or replace function public.mark_step(p_step text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  rank smallint := case p_step
    when 'opened' then 1 when 'named'  then 2 when 'school' then 3
    when 'dated'  then 4 when 'saving' then 5 when 'done'   then 6 end;
begin
  if auth.uid() is null or rank is null then return; end if;
  insert into public.registration_progress (user_id, furthest, step_name)
  values (auth.uid(), rank, p_step)
  on conflict (user_id) do update
    set last_seen = now(),
        -- only ever forwards: going back to fix a date is not losing ground
        furthest  = greatest(public.registration_progress.furthest, excluded.furthest),
        step_name = case when excluded.furthest > public.registration_progress.furthest
                         then excluded.step_name else public.registration_progress.step_name end;
end $$;

revoke execute on function public.mark_step(text) from public, anon;
grant  execute on function public.mark_step(text) to authenticated;
