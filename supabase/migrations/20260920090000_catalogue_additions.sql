-- ============================================================================
-- Every country, city and school a member adds — logged, and never lost.
--
-- Paul, 20 Sep 2026: "Registration has to be bullet proof. If there is a
-- country, city or school that isn't on the list, I want to pull out every
-- single stop... instead of throwing an error, send me an email, log it in the
-- database and have me review it."
--
-- THE MEMBER IS NEVER MADE TO WAIT FOR THAT REVIEW. They are registering, often
-- at night, often on a phone, and a school that needs approval before their
-- career can be typed in is a wall with a politer sign on it. The row is
-- created, they carry on, and the review happens afterwards — a correction to a
-- school re-runs the degrees by trigger, so fixing it later costs nothing.
--
-- Written by a TRIGGER, not by the client. The client can crash between the
-- insert and the log — that is exactly what happened on 13 Sep, when a school
-- was created and the form then threw, so seven schools exist that nobody's
-- history points at. A trigger cannot be skipped.
--
-- added_by references AUTH.USERS, not profiles: the people who most need this
-- are the ones who have not finished registering and so have no profile yet.
-- Five schools were added on the morning of 20 Sep by exactly such a person.
-- ============================================================================

create table if not exists public.catalogue_additions (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('school','city','country')),
  -- what was created (null for a country, which we cannot create — see below)
  entity_id    bigint,
  name         text not null,
  city         text,
  region       text,
  country      text,
  country_code text,
  -- who, and whether they had got as far as having a profile
  added_by     uuid references auth.users on delete set null,
  had_profile  boolean not null default false,
  -- what a reviewer decided
  status       text not null default 'new'
               check (status in ('new','ok','corrected','merged','rejected')),
  reviewed_at  timestamptz,
  review_note  text,
  -- for 'country': what they told us, since nothing was created
  member_note  text
);

create index if not exists catalogue_additions_new_idx
  on public.catalogue_additions (created_at desc) where status = 'new';

alter table public.catalogue_additions enable row level security;

-- Nobody reads this through the app. Paul reads it with tools/additions.sh,
-- which uses the service key. No policy means no access, which is the point:
-- it records who is mid-registration, and that is nobody else's business.

-- ── The trigger that cannot be skipped ──────────────────────────────────────
create or replace function public.log_school_addition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.added_by is null then return new; end if;   -- catalogue import, not a person
  insert into public.catalogue_additions
    (kind, entity_id, name, city, region, country, country_code, added_by, had_profile)
  values ('school', new.id, new.name, new.city, new.region, new.country, new.country_code,
          new.added_by, exists (select 1 from public.profiles where id = new.added_by));
  return new;
end $$;

drop trigger if exists log_school_addition_trg on public.schools;
create trigger log_school_addition_trg after insert on public.schools
  for each row execute function public.log_school_addition();

-- Cities carry no added_by column, so the actor is taken from the session. A
-- row inserted by the catalogue import runs as postgres and is not logged.
create or replace function public.log_city_addition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
begin
  if who is null then return new; end if;
  insert into public.catalogue_additions
    (kind, entity_id, name, city, region, country_code, added_by, had_profile)
  values ('city', new.id, new.name, new.name, new.region, new.country_code,
          who, exists (select 1 from public.profiles where id = who));
  return new;
end $$;

drop trigger if exists log_city_addition_trg on public.cities;
create trigger log_city_addition_trg after insert on public.cities
  for each row execute function public.log_city_addition();

-- ── A country nobody can add ────────────────────────────────────────────────
-- Schools and cities can be created by the person who needs them. A country
-- cannot: it is the top of the cascade, and 77 countries in the gazetteer have
-- no school at all, so anyone who taught in one of them met a dropdown that
-- simply did not contain their working life. This records the ask so the
-- country can be opened up, and it works before you have a profile.
create or replace function public.request_country(p_country text, p_note text default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  who uuid := auth.uid();
  new_id bigint;
begin
  if who is null then raise exception 'You are not signed in.'; end if;
  if length(btrim(coalesce(p_country,''))) < 2 then
    raise exception 'Tell us the country.';
  end if;
  -- one a minute is plenty for a person filling in a form
  if exists (select 1 from public.catalogue_additions
              where added_by = who and kind = 'country' and created_at > now() - interval '1 minute') then
    raise exception 'Just a moment — that has been sent.';
  end if;
  insert into public.catalogue_additions (kind, name, country, member_note, added_by, had_profile)
  values ('country', btrim(p_country), btrim(p_country), nullif(btrim(coalesce(p_note,'')),''),
          who, exists (select 1 from public.profiles where id = who))
  returning id into new_id;
  return new_id;
end $$;

revoke execute on function public.request_country(text, text) from public, anon;
grant  execute on function public.request_country(text, text) to authenticated;
