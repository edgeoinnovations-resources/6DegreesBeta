-- ============================================================================
-- Merge two duplicate schools, and stop that kind of duplicate recurring.
--
-- The first real connection in the database came out wrong. Paul and Linda both
-- work at ASD, but Paul picked "American School of Dubai" and Linda picked
-- "American School Dubai" — two separate rows — so they computed as degree 3
-- (same city, same time) instead of degree 1 (same school).
--
-- Both duplicates were introduced by hand: when the school list was built,
-- "American School of Dubai" and "American Community School of Abu Dhabi" were
-- pinned manually for the old demo characters, and the ISR list already carried
-- both, spelled without "of". A scan of all 2,130+ schools (same country, name
-- equal once of/the/de/do/da and punctuation are ignored) found these two pairs
-- and no others.
--
-- For each pair: keep the ISR row, give it the school's official name, move every
-- posting from the duplicate onto it, then delete the duplicate. Moving a posting
-- fires the degree trigger, so affected connections recompute in this migration.
-- ============================================================================

do $$
declare
  pair record;
  keep_id bigint;
  dup_id  bigint;
begin
  for pair in
    select * from (values
      ('United Arab Emirates', 'American School Dubai',               'American School of Dubai'),
      ('United Arab Emirates', 'American Community School Abu Dhabi', 'American Community School of Abu Dhabi')
    ) as v(country, isr_name, official_name)
  loop
    select id into keep_id from public.schools
     where country = pair.country and name = pair.isr_name;
    select id into dup_id from public.schools
     where country = pair.country and name = pair.official_name;

    if keep_id is null or dup_id is null then
      raise notice 'skipping %: keep=% dup=%', pair.official_name, keep_id, dup_id;
      continue;
    end if;

    -- Repoint first: postings.school_id is ON DELETE RESTRICT.
    update public.postings set school_id = keep_id where school_id = dup_id;
    delete from public.schools where id = dup_id;

    -- Only now can the kept row take the official name without breaking
    -- unique (name, country).
    update public.schools
       set name = pair.official_name, city_source = 'manual', is_verified = true
     where id = keep_id;
  end loop;
end $$;

-- Same-school duplicates are harmful precisely because they look fine: the graph
-- quietly reports a weaker degree. Tighten the member-add check so the small
-- connecting words that caused this one are ignored when comparing names.
create or replace function public.school_name_key(n text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(
           regexp_replace(lower(n), '\m(of|the|de|do|da|del|della|la|le|el|des|du)\M', '', 'g'),
           '[^a-z0-9]', '', 'g');
$$;

create or replace function public.schools_dedupe()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing text;
begin
  select s.name into existing
    from public.schools s
   where s.country = new.country
     and public.school_name_key(s.name) = public.school_name_key(new.name)
   limit 1;

  if existing is not null then
    raise exception 'That school is already listed as "%" — pick it from the list instead.', existing;
  end if;
  new.added_at = now();
  return new;
end $$;
