-- ============================================================================
-- SECURITY FIX: make views respect the caller's RLS, not the view owner's.
--
-- A Postgres view runs with the privileges of its OWNER unless it is created
-- `with (security_invoker = true)`. The owner here is the postgres superuser,
-- which RLS does not constrain — so `public.connections` was returning rows the
-- caller had no right to see, and the anon key is public and ships in every
-- browser.
--
-- Caught by querying the view as the `anon` role with data present. The earlier
-- check missed it because the tables were still empty, and an empty result looks
-- identical to a correctly denied one. Any future view must set this flag, and
-- must be tested WITH data in the tables.
-- ============================================================================

-- Rebuild the connections view with security_invoker.
drop view if exists public.connections;

create view public.connections
with (security_invoker = true) as
  select
    c.profile_a, c.profile_b,
    c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
    false as acknowledged,
    null::text as tag_keys
  from public.colleagueships c
  where not exists (
    select 1 from public.connection_tags t
     where t.status = 'approved'
       and least(t.requester_id, t.subject_id) = c.profile_a
       and greatest(t.requester_id, t.subject_id) = c.profile_b
  )
union all
  select
    least(t.requester_id, t.subject_id)    as profile_a,
    greatest(t.requester_id, t.subject_id) as profile_b,
    c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years,
    true as acknowledged,
    string_agg(distinct t.tag_key, ',')    as tag_keys
  from public.connection_tags t
  left join public.colleagueships c
    on c.profile_a = least(t.requester_id, t.subject_id)
   and c.profile_b = greatest(t.requester_id, t.subject_id)
  where t.status = 'approved'
  group by 1, 2, c.degree, c.context_type, c.context_label, c.time_relation, c.overlap_years;

-- Belt and braces: nothing in this schema is for anonymous callers. Every read
-- policy already requires an authenticated member, but revoking the grant means
-- a future table or view added without a policy fails closed rather than open.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Dropping and recreating a view discards its grants, so re-grant explicitly.
-- (RLS still decides which ROWS come back; these grants only decide who may ask.)
grant usage on schema public to authenticated;
grant select on public.connections      to authenticated;
grant select on public.public_profiles  to authenticated;
grant select on public.schools          to authenticated;
grant select on public.colleagueships   to authenticated;
grant select on public.tag_types        to authenticated;
grant select, insert, update, delete on public.profiles          to authenticated;
grant select, insert, update, delete on public.postings          to authenticated;
grant select, insert, update, delete on public.notes             to authenticated;
grant select, insert, update, delete on public.connection_tags   to authenticated;
grant select, insert, update, delete on public.privacy_settings  to authenticated;
grant select, insert, update, delete on public.contact_requests  to authenticated;
grant select, insert                 on public.invites           to authenticated;
grant usage, select on all sequences in schema public to authenticated;
