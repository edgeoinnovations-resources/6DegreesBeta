-- ============================================================================
-- "Having an issue?" — members report problems that do not crash.
--
-- client_errors has caught every exception since 13 Sep, which is how the RLS
-- failures and the fetch problems were found. It cannot catch the other half:
-- a school in the wrong city, a connection that makes no sense, a button that
-- does nothing. Those arrive days later as a screenshot in WhatsApp, if at all —
-- and the one thing that finally cracked the map bug was a video Paul recorded
-- himself, because it showed a symptom no instrumentation was watching for.
--
-- So: a button, a note, a screenshot, and the context captured automatically.
-- Reports land here and are emailed to Paul. tools/issues.sh lists them at the
-- start of a session, beside tools/errors.sh.
--
-- SCREENSHOTS CONTAIN OTHER MEMBERS' DATA — names, schools, career histories.
-- The bucket is private, members may write only into their own folder, and
-- nobody but the owner can read them back.
-- ============================================================================

create table if not exists public.issue_reports (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  reporter_id   uuid references public.profiles on delete set null,
  -- what they typed
  note          text not null check (length(btrim(note)) between 3 and 4000),
  -- captured for them, because "it didn't work" needs a screen and a build
  view          text,
  build         text,
  path          text,
  user_agent    text,
  window_size   text,
  -- anything client_errors logged in the minutes before they pressed the button
  recent_errors jsonb,
  screenshot    text,          -- storage object path, null if they attached none
  status        text not null default 'open' check (status in ('open','resolved','wontfix')),
  resolution    text,
  resolved_at   timestamptz
);

create index if not exists issue_reports_open_idx on public.issue_reports (created_at desc)
  where status = 'open';

alter table public.issue_reports enable row level security;

-- A member may file a report as themselves, and read back only their own.
drop policy if exists issue_insert on public.issue_reports;
create policy issue_insert on public.issue_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and public.is_member());

drop policy if exists issue_read_own on public.issue_reports;
create policy issue_read_own on public.issue_reports
  for select to authenticated
  using (reporter_id = auth.uid());

grant insert, select on public.issue_reports to authenticated;

-- Rate limit. Generous enough that nobody reporting real problems meets it.
create or replace function public.issue_reports_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  select count(*) into recent from public.issue_reports
   where reporter_id = new.reporter_id and created_at > now() - interval '1 hour';
  if recent >= 12 then
    raise exception 'That is a lot of reports in one hour. Tell Paul directly.'
      using errcode = '54000';
  end if;
  -- Never store an email address, however it arrives in the note.
  new.note := regexp_replace(new.note, '[[:alnum:]._%%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email removed]', 'g');
  return new;
end $$;

drop trigger if exists issue_reports_guard_trg on public.issue_reports;
create trigger issue_reports_guard_trg before insert on public.issue_reports
  for each row execute function public.issue_reports_guard();

revoke execute on function public.issue_reports_guard() from public, anon, authenticated;

-- ── Screenshots ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-screenshots', 'issue-screenshots', false, 8388608,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Write into your own folder only, and never read anything back — not even your
-- own. A screenshot may show other members; once it is sent it is for Paul.
drop policy if exists issue_shot_insert on storage.objects;
create policy issue_shot_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'issue-screenshots'
    and public.is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Reading them ────────────────────────────────────────────────────────────
create or replace view ops.issue_summary as
  select i.id,
         to_char(i.created_at, 'DD Mon HH24:MI') as when,
         coalesce(p.display_name, 'unknown') as who,
         i.view, i.build,
         left(i.note, 90) as note,
         (i.screenshot is not null) as has_screenshot,
         jsonb_array_length(coalesce(i.recent_errors, '[]'::jsonb)) as errors_around_it,
         i.status
    from public.issue_reports i
    left join public.profiles p on p.id = i.reporter_id
   order by (i.status = 'open') desc, i.created_at desc;
