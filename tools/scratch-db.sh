#!/bin/bash
# 6 Degrees — a throwaway Postgres with every migration applied.
#
#   bash tools/scratch-db.sh          # build it, print how to connect
#   bash tools/scratch-db.sh stop     # shut it down and delete it
#
# CLAUDE.md §4 says to test a migration locally before `db push` when it touches
# RLS, grants or triggers. This is that scratch database, so nobody has to work
# out the Supabase stubs again. It holds NO real member data — it is built from
# the migrations alone.
#
# Connect with:   psql -h /tmp/6dpg -p 55433 -U postgres -d sixdeg
#
# To act as a signed-in member inside it:
#   select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',false);
#   set role authenticated;   -- never test as postgres; it bypasses RLS
set -e
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

DATA="${TMPDIR:-/tmp}/6d-scratch-data"
# The socket lives in /tmp, not under DATA: a Unix socket path is capped at 103
# bytes and the session scratch directories blow straight past that.
SOCK=/tmp/6dpg
PORT=55433

if [ "$1" = "stop" ]; then
  pg_ctl -D "$DATA" stop >/dev/null 2>&1 || true
  rm -rf "$DATA" "$SOCK"
  echo "scratch database stopped and deleted"
  exit 0
fi

pg_ctl -D "$DATA" stop >/dev/null 2>&1 || true
rm -rf "$DATA" "$SOCK"
mkdir -p "$SOCK"
initdb -D "$DATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -l "$DATA/log" start >/dev/null
sleep 2
createdb -h "$SOCK" -p $PORT -U postgres sixdeg

# ── The Supabase pieces the migrations expect but a bare Postgres has not got ──
psql -h "$SOCK" -p $PORT -U postgres -d sixdeg -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'role', '');
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
SQL

fails=0
for f in supabase/migrations/*.sql; do
  out=$(psql -h "$SOCK" -p $PORT -U postgres -d sixdeg -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 | grep -v NOTICE || true)
  if echo "$out" | grep -q ERROR; then
    echo "FAIL  $(basename "$f")"; echo "$out" | head -8; fails=$((fails+1))
  fi
done

if [ $fails -eq 0 ]; then
  echo "all migrations applied cleanly"
  echo
  echo "  psql -h $SOCK -p $PORT -U postgres -d sixdeg"
  echo "  bash tools/scratch-db.sh stop     # when you're done"
else
  echo "$fails migration(s) failed"; exit 1
fi

# A test member needs an invite FIRST: a trigger on auth.users enforces invite-only,
# so inserting the user before the invite fails with "not been invited".
