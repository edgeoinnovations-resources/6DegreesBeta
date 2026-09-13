-- ============================================================================
-- Fix adding a school, which had never succeeded for anyone.
--
-- Linda, editing her history, could not add the American Embassy School in New
-- Delhi. Investigating found no member-added school anywhere in the database —
-- the "My school isn't listed" path had never worked for a single person.
--
-- 1. NEW MEMBERS COULD NEVER ADD A SCHOOL. schools.added_by referenced
--    public.profiles, but someone still on the registration form has no profile
--    yet — adding a school is precisely what they are doing before they save.
--    Every add from that screen would have failed the foreign key. It now
--    references auth.users, which exists from the moment you sign in.
--
-- 2. THE DUPLICATE MESSAGE SENT PEOPLE TO THE WRONG PLACE. The check is
--    country-wide, but the picker only shows one city at a time. AES was filed
--    under "Delhi" while Linda was looking under "New Delhi", so she was told it
--    was already listed and to pick it from a list where it did not appear. The
--    message now names the city it is actually filed under (and the client uses
--    that to select it for her).
--
-- 3. AES WAS IN THE WRONG CITY. It is in Chanakyapuri, New Delhi. Corrected.
-- ============================================================================

alter table public.schools drop constraint if exists schools_added_by_fkey;
alter table public.schools
  add constraint schools_added_by_fkey
  foreign key (added_by) references auth.users (id) on delete set null;

create or replace function public.schools_dedupe()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_name text;
  existing_city text;
begin
  select s.name, s.city into existing_name, existing_city
    from public.schools s
   where s.country = new.country
     and public.school_name_key(s.name) = public.school_name_key(new.name)
   limit 1;

  if existing_name is not null then
    -- Keep this exact shape: the client parses the name and city out of it to
    -- jump straight to the existing entry.
    raise exception 'ALREADY_LISTED|%|%', existing_name, coalesce(existing_city, '');
  end if;
  new.added_at = now();
  return new;
end $$;

do $$
declare lat double precision; lon double precision;
begin
  select latitude, longitude into lat, lon
    from public.cities where country_code = 'IN' and name = 'New Delhi'
    order by population desc limit 1;
  update public.schools
     set city = 'New Delhi',
         latitude = coalesce(lat, latitude), longitude = coalesce(lon, longitude),
         city_source = 'manual', is_verified = true
   where country = 'India' and name = 'American Embassy School Delhi';
end $$;
