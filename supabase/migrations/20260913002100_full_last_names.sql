-- ============================================================================
-- Full last names instead of a last initial.
--
-- Paul, 13 Sep 2026: "I want to take last names now. Can you fix this so we enter
-- full last names instead of just the initial?" This reverses the earlier "first
-- name + last initial only" rule. Existing members registered under that rule, so
-- nobody's last name is filled in for them: each adds their own.
--
--   * profiles.last_name (new). last_initial stays and is kept in step with it, so
--     a member who hasn't updated yet still displays as "Linda H.".
--   * display_name now prefers the full last name, falling back to the initial.
--   * public_profiles exposes last_name, and still hides every name for a ghost.
--   * save_my_profile gains p_last_name. It keeps accepting p_last_initial, because
--     GitHub Pages serves the old client for ~10 minutes after a deploy and those
--     saves must not fail. A save that sends only an initial never erases a last
--     name already on file.
--   * ghost_me also clears last_name — a full name is more identifying than an
--     initial.
-- ============================================================================

alter table public.profiles
  add column if not exists last_name text
  check (last_name is null or length(btrim(last_name)) between 1 and 80);

-- display_name is a generated column, which cannot be altered in place, and the
-- public_profiles view depends on it.
drop view if exists public.public_profiles;
alter table public.profiles drop column if exists display_name;
alter table public.profiles add column display_name text generated always as (
  first_name || case
    when last_name is not null and btrim(last_name) <> '' then ' ' || btrim(last_name)
    when last_initial is not null and btrim(last_initial) <> '' then ' ' || upper(left(btrim(last_initial), 1)) || '.'
    else ''
  end
) stored;

create view public.public_profiles
with (security_invoker = true) as
  select
    p.id,
    case when p.status = 'ghost' then 'Former member' else p.display_name end as display_name,
    case when p.status = 'ghost' then null else p.first_name end     as first_name,
    case when p.status = 'ghost' then null else p.last_name end      as last_name,
    case when p.status = 'ghost' then null else p.last_initial end   as last_initial,
    case when p.status = 'ghost' then null else p.nationality end    as nationality,
    case when p.status = 'ghost' then null else p.specialization end as specialization,
    p.status,
    p.created_at
  from public.profiles p;

-- Recreating a view drops its grants.
grant select on public.public_profiles to authenticated;

-- ── Registration / editing ──────────────────────────────────────────────────
-- Replaced rather than overloaded: two functions with the same argument types are
-- not allowed, and an overload would make PostgREST's resolution ambiguous. Every
-- parameter after the first has a default, so a call from the OLD client (five
-- named arguments, p_last_initial) still resolves to this function.
drop function if exists public.save_my_profile(text, text, text, text, jsonb);

create function public.save_my_profile(
  p_first_name     text,
  p_last_initial   text  default null,
  p_nationality    text  default null,
  p_specialization text  default null,
  p_postings       jsonb default null,
  p_last_name      text  default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := auth.uid();
  v_last    text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_initial text;
  n         int;
begin
  if me is null then
    raise exception 'You are not signed in. Reload the page and sign in again.'
      using errcode = '28000';
  end if;

  if coalesce(btrim(p_first_name), '') = '' then
    raise exception 'A first name is required.' using errcode = '22023';
  end if;

  if p_postings is null or jsonb_array_length(p_postings) = 0 then
    raise exception 'Add at least one posting — a school and a start date.'
      using errcode = '22023';
  end if;

  v_initial := coalesce(upper(left(v_last, 1)),
                        nullif(upper(left(btrim(coalesce(p_last_initial, '')), 1)), ''));

  insert into public.profiles (id, first_name, last_name, last_initial, nationality, specialization)
  values (me, btrim(p_first_name), v_last, v_initial,
          nullif(btrim(coalesce(p_nationality, '')), ''),
          nullif(btrim(coalesce(p_specialization, '')), ''))
  on conflict (id) do update
    set first_name     = excluded.first_name,
        -- an old client sends no last name: keep the one on file rather than wipe it
        last_name      = coalesce(excluded.last_name, profiles.last_name),
        last_initial   = coalesce(excluded.last_initial, profiles.last_initial),
        nationality    = excluded.nationality,
        specialization = excluded.specialization;

  insert into public.privacy_settings (profile_id) values (me)
  on conflict (profile_id) do nothing;

  delete from public.postings where profile_id = me;

  insert into public.postings (profile_id, school_id, role, start_date, end_date)
  select me,
         (p ->> 'school_id')::bigint,
         coalesce(nullif(p ->> 'role', ''), 'Faculty'),
         (p ->> 'start_date')::date,
         nullif(p ->> 'end_date', '')::date
    from jsonb_array_elements(p_postings) as p
   where (p ->> 'school_id') is not null
     and (p ->> 'start_date') is not null;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'None of those postings had both a school and a start date.'
      using errcode = '22023';
  end if;

  return me;
end $$;

-- Functions are not executable by default in this schema (20260913001800).
revoke execute on function public.save_my_profile(text, text, text, text, jsonb, text) from public, anon;
grant  execute on function public.save_my_profile(text, text, text, text, jsonb, text) to authenticated;

-- ── Leaving ─────────────────────────────────────────────────────────────────
create or replace function public.ghost_me()
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  update public.profiles
     set status = 'ghost', ghosted_at = now(),
         last_name = null, nationality = null, specialization = null
   where id = me;
  delete from public.notes where author_id = me;
end $$;
