-- ============================================================================
-- Two profile changes the group settled in the chat of 14-16 Sep 2026.
--
-- 1. A PREFERRED NAME. Dee, 14 Sep: "could we add a 'commonly used name' field?
--    Like my name is Deanna but 99% of the world knows me as Dee." Paul: "Yup.
--    We'll add a Preferred Name field. Easy." It REPLACES the first name for
--    display; the legal first name stays on the record because that is what
--    someone searching an old staff list will have.
--
-- 2. NATIONALITY AND SUBJECT ARE GONE. Melissa asked what they were for; they
--    turned out to be leftovers from the first Survey123 form that feed nothing.
--    Sarah: "eliminating nationality is a good idea... don't think it needs to be
--    searchable." Linda: "if we're not using it then there's no reason to ask for
--    it." Melissa: "keep it simple." Paul agreed. The free text also proved the
--    point on its own — the seven of us wrote USA, American and Canadian for the
--    same field. If we ever want to find people by subject it becomes a dropdown,
--    which is a different thing built on purpose.
--
-- This DESTROYS the nationality and specialization values of seven real members.
-- That is the agreed intent, not a side effect.
--
-- display_name is a generated column and public_profiles depends on it, so both
-- are rebuilt rather than altered.
-- ============================================================================

alter table public.profiles
  add column if not exists preferred_name text
  check (preferred_name is null or length(btrim(preferred_name)) between 1 and 60);

drop view if exists public.public_profiles;
alter table public.profiles drop column if exists display_name;

alter table public.profiles drop column if exists nationality;
alter table public.profiles drop column if exists specialization;

-- Preferred name wins over first name; full last name wins over the old initial.
alter table public.profiles add column display_name text generated always as (
  coalesce(nullif(btrim(preferred_name), ''), first_name) || case
    when last_name is not null and btrim(last_name) <> '' then ' ' || btrim(last_name)
    when last_initial is not null and btrim(last_initial) <> '' then ' ' || upper(left(btrim(last_initial), 1)) || '.'
    else ''
  end
) stored;

create view public.public_profiles
with (security_invoker = true) as
  select
    p.id,
    case when p.status = 'ghost' then 'Former member' else p.display_name end   as display_name,
    case when p.status = 'ghost' then null else p.first_name end     as first_name,
    case when p.status = 'ghost' then null else p.last_name end      as last_name,
    case when p.status = 'ghost' then null else p.last_initial end   as last_initial,
    case when p.status = 'ghost' then null else p.preferred_name end as preferred_name,
    p.status,
    p.created_at
  from public.profiles p;

grant select on public.public_profiles to authenticated;   -- recreating a view drops grants

-- ── Registration / editing ──────────────────────────────────────────────────
-- p_nationality and p_specialization are KEPT in the signature and ignored. GitHub
-- Pages serves the previous client for about ten minutes after a deploy, and a save
-- from one of those tabs must not fail just because two fields went away.
drop function if exists public.save_my_profile(text, text, text, text, jsonb, text);

create function public.save_my_profile(
  p_first_name     text,
  p_last_initial   text  default null,
  p_nationality    text  default null,   -- ignored; kept for older clients
  p_specialization text  default null,   -- ignored; kept for older clients
  p_postings       jsonb default null,
  p_last_name      text  default null,
  -- NOT null-defaulted. A null has to mean "clear my preferred name", so "the
  -- client never mentioned this field" needs a value of its own. PostgREST passes
  -- only the arguments a client names, so an older client leaves this at the
  -- sentinel and its preferred name is left alone rather than wiped.
  p_preferred_name text  default '\x00_unset'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid := auth.uid();
  v_last     text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_pref_set boolean := p_preferred_name is distinct from '\x00_unset';
  v_pref     text := case when p_preferred_name is distinct from '\x00_unset'
                          then nullif(btrim(coalesce(p_preferred_name, '')), '') end;
  v_initial  text;
  n          int;
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

  insert into public.profiles (id, first_name, last_name, last_initial, preferred_name)
  values (me, btrim(p_first_name), v_last, v_initial, v_pref)
  on conflict (id) do update
    set first_name   = excluded.first_name,
        -- an old client sends no last name: keep the one on file rather than wipe it
        last_name    = coalesce(excluded.last_name, profiles.last_name),
        last_initial = coalesce(excluded.last_initial, profiles.last_initial),
        -- A client that named the field wins, even with null: clearing it is how
        -- you stop going by another name. A client that never named it changes
        -- nothing.
        preferred_name = case when v_pref_set then v_pref else profiles.preferred_name end;

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

revoke execute on function public.save_my_profile(text, text, text, text, jsonb, text, text) from public, anon;
grant  execute on function public.save_my_profile(text, text, text, text, jsonb, text, text) to authenticated;

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
         last_name = null, preferred_name = null
   where id = me;
  delete from public.notes where author_id = me;
end $$;
