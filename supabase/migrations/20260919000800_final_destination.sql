-- ============================================================================
-- Final Destination — where someone has retired, or expects to.
--
-- Asked for by a member: international teachers scatter, and when they stop
-- moving they would like to know who else stopped nearby. It is the one place
-- fact this product did not hold.
--
-- IT IS NOT A DEGREE, and that is deliberate. The six degrees come from where
-- people WORKED and when, they are fixed, and Paul has defended that since
-- September. Two people retiring in the same town is a real connection but a
-- different kind, so it is searchable and mappable and touches the degree engine
-- nowhere.
--
-- Two questions, because one is not enough to write the sentence:
--   * which city (from the gazetteer, so it is structured and can be mapped)
--   * are you there yet, or is it the plan
-- so the app can say "Retired in Chiang Mai" or "Plans to retire in Chiang Mai"
-- rather than guessing which.
--
-- Visible to members by default, with a toggle, the same shape as the messaging
-- preference. It is more personal than a work history: it is where somebody
-- actually lives.
-- ============================================================================

alter table public.profiles
  add column if not exists final_city text
    check (final_city is null or length(btrim(final_city)) between 1 and 120),
  add column if not exists final_region text
    check (final_region is null or length(btrim(final_region)) <= 60),
  add column if not exists final_country text
    check (final_country is null or length(btrim(final_country)) between 1 and 80),
  add column if not exists final_status text
    check (final_status is null or final_status in ('there','planned')),
  add column if not exists final_public boolean not null default true;

comment on column public.profiles.final_status is
  '''there'' = already living there, ''planned'' = expects to. Null means not answered.';

-- Rebuilt because public_profiles selects from profiles and must carry the new
-- fields — and must respect both the ghost rule and the member's own toggle.
drop view if exists public.public_profiles;

create view public.public_profiles
with (security_invoker = true) as
  select
    p.id,
    case when p.status = 'ghost' then 'Former member' else p.display_name end   as display_name,
    case when p.status = 'ghost' then null else p.first_name end     as first_name,
    case when p.status = 'ghost' then null else p.last_name end      as last_name,
    case when p.status = 'ghost' then null else p.last_initial end   as last_initial,
    case when p.status = 'ghost' then null else p.preferred_name end as preferred_name,
    -- hidden if they left, and hidden if they asked for it to be
    case when p.status = 'ghost' or not p.final_public then null else p.final_city end    as final_city,
    case when p.status = 'ghost' or not p.final_public then null else p.final_region end  as final_region,
    case when p.status = 'ghost' or not p.final_public then null else p.final_country end as final_country,
    case when p.status = 'ghost' or not p.final_public then null else p.final_status end  as final_status,
    p.status,
    p.created_at
  from public.profiles p;

grant select on public.public_profiles to authenticated;   -- recreating drops grants

-- ── Saving it ───────────────────────────────────────────────────────────────
-- Its own call rather than more arguments on save_my_profile: that function
-- rewrites every posting you have, and somebody ticking a box about retirement
-- should not have their career history deleted and reinserted to do it.
create or replace function public.save_final_destination(
  p_city    text default null,
  p_region  text default null,
  p_country text default null,
  p_state   text default null,      -- 'there' | 'planned'
  p_public  boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_ctry text := nullif(btrim(coalesce(p_country, '')), '');
begin
  if me is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;
  if (v_city is null) <> (v_ctry is null) then
    raise exception 'A final destination needs both a city and a country.' using errcode = '22023';
  end if;
  if p_state is not null and p_state not in ('there','planned') then
    raise exception 'Say whether you are already there or still planning.' using errcode = '22023';
  end if;

  update public.profiles
     set final_city    = v_city,
         final_region  = nullif(btrim(coalesce(p_region, '')), ''),
         final_country = v_ctry,
         final_status  = case when v_city is null then null else p_state end,
         final_public  = coalesce(p_public, true)
   where id = me;
end $$;

revoke execute on function public.save_final_destination(text, text, text, text, boolean) from public, anon;
grant  execute on function public.save_final_destination(text, text, text, text, boolean) to authenticated;

-- ── Who else stopped nearby ─────────────────────────────────────────────────
-- The whole point of the feature. Members only, respecting the toggle, and it
-- never exposes anything public_profiles would not.
create or replace function public.who_else_retired(p_city text default null, p_country text default null)
returns table (
  id           uuid,
  display_name text,
  final_city   text,
  final_region text,
  final_country text,
  final_status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with target as (
    select coalesce(nullif(btrim(coalesce(p_city, '')), ''),
                    (select pr.final_city from public.profiles pr where pr.id = auth.uid())) as city,
           coalesce(nullif(btrim(coalesce(p_country, '')), ''),
                    (select pr.final_country from public.profiles pr where pr.id = auth.uid())) as country
  )
  select v.id, v.display_name, v.final_city, v.final_region, v.final_country, v.final_status
    from public.public_profiles v, target t
   where v.final_city is not null
     and t.city is not null
     and lower(v.final_city) = lower(t.city)
     and lower(coalesce(v.final_country, '')) = lower(coalesce(t.country, ''))
     and v.id <> auth.uid()
   order by v.display_name;
$$;

revoke execute on function public.who_else_retired(text, text) from public, anon;
grant  execute on function public.who_else_retired(text, text) to authenticated;

create index if not exists profiles_final_place_idx
  on public.profiles (final_country, final_city) where final_city is not null;
