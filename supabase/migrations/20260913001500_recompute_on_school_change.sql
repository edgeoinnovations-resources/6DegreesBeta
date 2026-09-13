-- ============================================================================
-- Recompute connections when a SCHOOL changes, not only when a posting does.
--
-- colleagueships stores a context label ("American School of Dubai", "Dubai,
-- United Arab Emirates") alongside the degree. The previous migration merged two
-- duplicate schools by moving postings first and renaming second — so the degree
-- trigger fired on the move, captured the OLD name, and Paul and Linda's degree-1
-- connection went on reading "American School Dubai".
--
-- More importantly a city or country correction (like Campinas earlier today)
-- changes the DEGREE ITSELF, and nothing recomputed on that either. So: whenever
-- a school's name, city or country changes, recompute everyone with a posting
-- there.
-- ============================================================================

create or replace function public.schools_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.name is distinct from old.name
     or new.city is distinct from old.city
     or new.country is distinct from old.country then
    for r in select distinct profile_id from public.postings where school_id = new.id loop
      perform public.recompute_for_profile(r.profile_id);
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists schools_recompute_trg on public.schools;
create trigger schools_recompute_trg
  after update on public.schools
  for each row execute function public.schools_recompute();

-- Repair what is already stale.
select public.recompute_all();
