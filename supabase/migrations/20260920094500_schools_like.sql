-- ============================================================================
-- "Did you mean this one?" — before a member adds a school that already exists.
--
-- On 20 Sep somebody added "International School of Choueifat, Lahore" and
-- filed it under Lebanon. "International School Choueifat", Lahore, Pakistan,
-- was already in the catalogue, verified and geocoded. Nothing caught it: the
-- dedupe trigger compares school_name_key(), and a trailing ", Lahore" is
-- enough to make two keys differ.
--
-- A duplicate school is the most expensive mistake this database can make. Two
-- colleagues who pick different rows for the SAME STAFFROOM come out as degree
-- 3 — same city — instead of degree 1, and nothing anywhere says so.
--
-- So: look for near matches and show them to the member BEFORE they add, and to
-- Paul in the email afterwards. Deliberately loose — a false suggestion costs a
-- glance, a missed duplicate costs a degree. Matching ignores case, punctuation
-- and the words that appear in half the schools in the world, and it looks
-- across the whole world, not just the country they picked: filing a Pakistani
-- school under Lebanon is exactly the mistake being caught.
-- ============================================================================

create or replace function public.schools_like(p_name text, p_country text default null)
returns table (
  id          bigint,
  name        text,
  city        text,
  country     text,
  is_verified boolean,
  postings    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with q as (
    select public.school_name_key(coalesce(p_name,'')) as k,
           -- the same key with the common words stripped, so "International
           -- School Choueifat" and "Choueifat School" still meet
           regexp_replace(public.school_name_key(coalesce(p_name,'')),
                          'international|school|academy|college|the|of|and', '', 'g') as core
  )
  select s.id, s.name, s.city, s.country, s.is_verified,
         (select count(*) from public.postings po where po.school_id = s.id)
    from public.schools s, q
   where length(q.k) > 2
     and (
       -- one name contains the other, either way round
       public.school_name_key(s.name) like '%' || q.k || '%'
       or q.k like '%' || public.school_name_key(s.name) || '%'
       -- or their distinctive parts do
       or (length(q.core) > 3 and regexp_replace(public.school_name_key(s.name),
             'international|school|academy|college|the|of|and', '', 'g') like '%' || q.core || '%')
     )
   order by (s.country is not distinct from p_country) desc, s.is_verified desc, s.name
   limit 12;
$$;

revoke execute on function public.schools_like(text, text) from public, anon;
-- authenticated, not is_member(): the people adding schools are the ones still
-- registering, and they are exactly who this is meant to stop.
grant execute on function public.schools_like(text, text) to authenticated, service_role;
