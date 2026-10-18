-- ============================================================================
-- A shared HOME country is not a connection.
--
-- Linda's point, relayed by Paul on 18 Oct 2026: so many members have taught
-- back home in the United States that "same country" (degrees 5 and 6) was
-- going to connect every American to every other American, and to everyone
-- who ever did a stint there. The six degrees are meant to say who might know
-- whom; "we are both from the US" says nothing of the kind.
--
-- Paul's decision, the same day: each member states their OWN home country,
-- and that country is skipped at the country level for them. Precisely:
--
--   * A posting pair that shares only a COUNTRY earns no degree 5 or 6 when
--     that country is the home country of EITHER person. Symmetric, because the
--     swamp is symmetric: an American and a Briton who once taught in Ohio were
--     "connected" by the American being at home.
--   * Same SCHOOL (1, 2) and same CITY (3, 4) still count everywhere. Two people
--     at the same Minneapolis school at the same time knew each other, home or
--     not — Paul, 6 Sep 2025: "US based schools are fair game."
--   * The map and the globe are untouched. They draw from postings, never from
--     degrees, so the home-country schools stay in everyone's journey — which
--     Paul wants, because "for the visualization it makes it look great".
--
-- Nobody has set a home country yet, so nothing changes today. Each member's
-- degrees are recomputed the moment they set theirs, by the trigger below.
-- ============================================================================

alter table public.profiles
  add column if not exists home_country text
    references public.countries(name) on update cascade;

comment on column public.profiles.home_country is
  'Stated by the member. A shared country gives no degree 5/6 when it is either person''s home country. Schools and cities there still count.';

-- ── Members may see it, in step with everything else about a member ─────────
-- Appended at the end, which is the one shape CREATE OR REPLACE VIEW allows.
create or replace view public.public_profiles
with (security_invoker = true) as
  select
    p.id,
    case when p.status = 'ghost' then 'Former member' else p.display_name end   as display_name,
    case when p.status = 'ghost' then null else p.first_name end     as first_name,
    case when p.status = 'ghost' then null else p.last_name end      as last_name,
    case when p.status = 'ghost' then null else p.last_initial end   as last_initial,
    case when p.status = 'ghost' then null else p.preferred_name end as preferred_name,
    case when p.status = 'ghost' or not p.final_public then null else p.final_city end    as final_city,
    case when p.status = 'ghost' or not p.final_public then null else p.final_region end  as final_region,
    case when p.status = 'ghost' or not p.final_public then null else p.final_country end as final_country,
    case when p.status = 'ghost' or not p.final_public then null else p.final_status end  as final_status,
    p.status,
    p.created_at,
    case when p.status = 'ghost' then null else p.home_country end   as home_country
  from public.profiles p;

-- ── The rule, in the one place degrees are computed ─────────────────────────
-- Identical to the 20 Sep version (headline tie-break) except for `my_home`,
-- `their_home`, and the one extra condition in `pairs`.
create or replace function public.recompute_for_profile(p uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  n       integer;
  my_home text := coalesce((select pr.home_country from public.profiles pr where pr.id = p), '');
begin
  delete from public.colleagueships  where profile_a = p or profile_b = p;
  delete from public.shared_contexts where profile_a = p or profile_b = p;

  with mine as (
    select po.school_id,
           case when s.city_confidence in ('high','medium') then s.city end as city,
           s.region, s.country, po.start_date, po.end_date
      from public.postings po join public.schools s on s.id = po.school_id
     where po.profile_id = p
  ),
  theirs as (
    select po.profile_id, po.school_id,
           case when s.city_confidence in ('high','medium') then s.city end as city,
           s.region, s.country, po.start_date, po.end_date,
           coalesce(pr.home_country, '') as their_home
      from public.postings po
      join public.schools  s  on s.id  = po.school_id
      join public.profiles pr on pr.id = po.profile_id
     where po.profile_id <> p
  ),
  pairs as (
    select t.profile_id as other, d.degree, d.context_type, d.context_label, d.same_time,
           public.overlap_years(m.start_date, m.end_date, t.start_date, t.end_date) as oy,
           greatest(m.start_date, t.start_date) as overlap_start,
           (m.end_date is null and t.end_date is null) as both_still_there
      from mine m
      join theirs t on t.country = m.country
      cross join lateral public.pair_degree(
        m.school_id, m.city, m.region, m.country, m.start_date, m.end_date,
        t.school_id, t.city, t.region, t.country, t.start_date, t.end_date) d
     where d.degree is not null
       -- THE RULE. A country-level match is dropped when the country is home to
       -- either of them. School and city matches pass through untouched.
       and not (d.context_type = 'country'
                and (d.context_label = my_home or d.context_label = t.their_home))
  ),
  best as (
    select distinct on (other)
           other, degree, context_type, context_label, same_time, oy
      from pairs
     order by other, degree asc, both_still_there desc, overlap_start desc
  ),
  headline as (
    insert into public.colleagueships
      (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years, computed_at)
    select least(p, other), greatest(p, other), degree, context_type, context_label,
           case when same_time then 'same time' else 'different time' end,
           case when same_time then oy else '' end, now()
      from best
    on conflict (profile_a, profile_b) do update
      set degree = excluded.degree, context_type = excluded.context_type,
          context_label = excluded.context_label, time_relation = excluded.time_relation,
          overlap_years = excluded.overlap_years, computed_at = now()
    returning 1
  )
  insert into public.shared_contexts
    (profile_a, profile_b, degree, context_type, context_label, time_relation, overlap_years)
  select distinct least(p, other), greatest(p, other), degree, context_type, context_label,
         case when same_time then 'same time' else 'different time' end,
         case when same_time then oy else '' end
    from pairs
  on conflict do nothing;

  select count(*) into n from public.colleagueships where profile_a = p or profile_b = p;
  return n;
end $$;

-- ── Setting it recomputes you, like a changed posting does ──────────────────
create or replace function public.profiles_home_recompute()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.home_country is distinct from old.home_country then
    perform public.recompute_for_profile(new.id);
  end if;
  return new;
end $$;

drop trigger if exists profiles_home_recompute_trg on public.profiles;
create trigger profiles_home_recompute_trg
  after update of home_country on public.profiles
  for each row execute function public.profiles_home_recompute();

-- ── save_my_profile learns the field ────────────────────────────────────────
-- Same sentinel trick as preferred_name: a client that never names the argument
-- changes nothing; one that sends null clears it. A new signature means the old
-- one must go, or PostgREST cannot choose between two functions that both
-- accept the old call.
drop function if exists public.save_my_profile(text, text, text, text, jsonb, text, text);

create function public.save_my_profile(
  p_first_name     text,
  p_last_initial   text  default null,
  p_nationality    text  default null,   -- ignored; kept for older clients
  p_specialization text  default null,   -- ignored; kept for older clients
  p_postings       jsonb default null,
  p_last_name      text  default null,
  p_preferred_name text  default '\x00_unset',
  p_home_country   text  default '\x00_unset'
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
  v_home_set boolean := p_home_country is distinct from '\x00_unset';
  v_home     text := case when p_home_country is distinct from '\x00_unset'
                          then nullif(btrim(coalesce(p_home_country, '')), '') end;
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

  if v_home is not null and not exists (select 1 from public.countries c where c.name = v_home) then
    raise exception 'Pick your home country from the list.' using errcode = '22023';
  end if;

  v_initial := coalesce(upper(left(v_last, 1)),
                        nullif(upper(left(btrim(coalesce(p_last_initial, '')), 1)), ''));

  insert into public.profiles (id, first_name, last_name, last_initial, preferred_name, home_country)
  values (me, btrim(p_first_name), v_last, v_initial, v_pref, v_home)
  on conflict (id) do update
    set first_name   = excluded.first_name,
        last_name    = coalesce(excluded.last_name, profiles.last_name),
        last_initial = coalesce(excluded.last_initial, profiles.last_initial),
        preferred_name = case when v_pref_set then v_pref else profiles.preferred_name end,
        home_country   = case when v_home_set then v_home else profiles.home_country end;

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

revoke execute on function public.save_my_profile(text, text, text, text, jsonb, text, text, text) from public, anon;
grant  execute on function public.save_my_profile(text, text, text, text, jsonb, text, text, text) to authenticated;
