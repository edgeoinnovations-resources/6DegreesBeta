-- ============================================================================
-- Members can add a school (and a city) that isn't listed.
--
-- Asked for from the very beginning and never built until now —
--   Linda, 6 Sep 2025: "And then it could be a drop down but with the option to
--   add a school that's not listed?"
--   Melissa, 7 Sep 2025: "I added a pin on the map for a school that wasn't
--   listed ... I wonder if this might cause duplicates"
-- and hit immediately in real use: Escola Americana de Campinas was filed under
-- the wrong city, so its real city had no entry at all.
--
-- Melissa's duplicate worry is handled by the existing unique (name, country) on
-- schools, plus a normalised check below that also catches case and spacing.
--
-- Dave's governance question — "Who's going to add a school or delete it when it
-- goes belly up ... Who's in charge?" — is NOT answered here, deliberately.
-- Members may ADD, flagged unverified. Nobody may edit or delete someone else's
-- school through the client. That decision stays with the group.
-- ============================================================================

-- Who added it, so a bad entry can be traced and talked about.
alter table public.schools
  add column if not exists added_by uuid references public.profiles on delete set null,
  add column if not exists added_at timestamptz;

-- Any authenticated user may add a school. They must mark it unverified and own
-- the attribution; they cannot pass it off as part of the seeded reference set.
drop policy if exists schools_insert_member on public.schools;
create policy schools_insert_member on public.schools
  for insert to authenticated
  with check (
    added_by = auth.uid()
    and is_verified = false
    and city_source = 'manual'
    and length(btrim(name)) between 2 and 160
    and length(btrim(country)) > 0
  );

grant insert on public.schools to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- No update or delete policy for schools: adding is a member action, curating is
-- not. See the note above.

-- Reject near-duplicates that the unique(name, country) constraint would miss —
-- different case, extra spaces, or punctuation.
create or replace function public.schools_dedupe()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing text;
begin
  select s.name into existing
    from public.schools s
   where s.country = new.country
     and regexp_replace(lower(s.name), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(new.name), '[^a-z0-9]', '', 'g')
   limit 1;

  if existing is not null then
    raise exception 'That school is already listed as "%" — pick it from the list instead.', existing;
  end if;
  new.added_at = now();
  return new;
end $$;

drop trigger if exists schools_dedupe_trg on public.schools;
create trigger schools_dedupe_trg
  before insert on public.schools
  for each row execute function public.schools_dedupe();

-- ── Correct the two schools we know are filed under the wrong city ───────────
-- "Americana" is Portuguese for "American" AND a real Brazilian city, so the
-- longest-match rule preferred the adjective over the actual place name.
do $$
declare
  camp_lat double precision; camp_lon double precision;
  rec_lat  double precision; rec_lon  double precision;
begin
  select latitude, longitude into camp_lat, camp_lon
    from public.cities where country_code = 'BR' and name = 'Campinas'
    order by population desc limit 1;
  select latitude, longitude into rec_lat, rec_lon
    from public.cities where country_code = 'BR' and name = 'Recife'
    order by population desc limit 1;

  update public.schools
     set city = 'Campinas', latitude = coalesce(camp_lat, latitude),
         longitude = coalesce(camp_lon, longitude), city_source = 'manual'
   where country = 'Brazil' and name = 'Escola Americana de Campinas';

  update public.schools
     set city = 'Recife', latitude = coalesce(rec_lat, latitude),
         longitude = coalesce(rec_lon, longitude), city_source = 'manual'
   where country = 'Brazil' and name = 'Escola Americana de Recife';
end $$;
