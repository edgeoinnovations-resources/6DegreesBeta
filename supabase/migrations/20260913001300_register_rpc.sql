-- ============================================================================
-- Registration as a single server-side call.
--
-- The client used to send its own id: `upsert({ id: user.id, ... })`, checked by
-- `with check (id = auth.uid())`. That works right up until the id the browser is
-- holding and the JWT the request carries drift apart — a long form left open, a
-- token refresh, or a second magic link invalidating the first session. The
-- failure is then a bare "new row violates row-level security policy", which
-- tells the user nothing and is miserable to debug.
--
-- The fix is to stop asking. The database already knows who is calling, so the
-- client no longer supplies an id at all: these functions take auth.uid() as the
-- only possible answer. The whole class of mismatch disappears, and the client
-- gets one atomic call instead of four writes that can half-succeed.
-- ============================================================================

-- Save (or update) the caller's profile, privacy row, and postings in one go.
--
-- postings is a JSON array of { school_id, role, start_date, end_date|null }.
create or replace function public.save_my_profile(
  p_first_name     text,
  p_last_initial   text,
  p_nationality    text,
  p_specialization text,
  p_postings       jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n  int;
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

  insert into public.profiles (id, first_name, last_initial, nationality, specialization)
  values (me, btrim(p_first_name), nullif(btrim(coalesce(p_last_initial, '')), ''),
          nullif(btrim(coalesce(p_nationality, '')), ''),
          nullif(btrim(coalesce(p_specialization, '')), ''))
  on conflict (id) do update
    set first_name     = excluded.first_name,
        last_initial   = excluded.last_initial,
        nationality    = excluded.nationality,
        specialization = excluded.specialization;

  insert into public.privacy_settings (profile_id) values (me)
  on conflict (profile_id) do nothing;

  -- Replace wholesale. Simpler than diffing, and the postings trigger recomputes
  -- degrees either way. Atomic: a failure here rolls the profile back too, rather
  -- than leaving someone half-registered.
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

revoke execute on function public.save_my_profile(text, text, text, text, jsonb) from public, anon;
grant  execute on function public.save_my_profile(text, text, text, text, jsonb) to authenticated;

-- Leaving. Not a delete: the postings stay so everyone else's degrees remain
-- correct, and the name is withheld. ("You're actually forever a part of our data
-- ecosystem that you can't pluck yourself out of without ruining this house of
-- cards ... so we give you a ghost profile.")
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
         nationality = null, specialization = null
   where id = me;
  delete from public.notes where author_id = me;
end $$;

revoke execute on function public.ghost_me() from public, anon;
grant  execute on function public.ghost_me() to authenticated;
