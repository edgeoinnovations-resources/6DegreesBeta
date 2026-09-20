#!/bin/bash
# 6 Degrees — countries, cities and schools that members had to add themselves.
#
#   bash tools/additions.sh                 waiting for review, newest first
#   bash tools/additions.sh all             everything, reviewed or not
#   bash tools/additions.sh show <id>       one addition in full
#   bash tools/additions.sh near <id>       schools that look like this one
#   bash tools/additions.sh ok <id> "note"  reviewed, the row is right as it is
#   bash tools/additions.sh done <id> "note"  reviewed and corrected by hand
#
# Every one of these is somebody hitting the edge of the catalogue while typing
# their own career in. Paul, 20 Sep 2026: "instead of throwing an error, send me
# an email, log it in the database and have me review it."
#
# The member is NOT waiting on this. Their row was created and they carried on;
# a correction here re-runs the degrees by trigger. Read it beside errors.sh and
# issues.sh at the start of a session.
set -e
cd "$(dirname "$0")/.."
SB="${SUPABASE_BIN:-$HOME/.local/bin/supabase}"

run() {
  "$SB" db query "$1" --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
except Exception:
    print(raw.strip()[:400]); sys.exit(1)
rows = d.get("rows") or []
if not rows:
    print("  (nothing)"); sys.exit(0)
cols = list(rows[0].keys())
w = {c: min(60, max(len(c), *(len(str(r.get(c) if r.get(c) is not None else "")) for r in rows))) for c in cols}
print("  " + "  ".join(c.ljust(w[c]) for c in cols))
print("  " + "  ".join("-" * w[c] for c in cols))
for r in rows:
    print("  " + "  ".join(str(r.get(c) if r.get(c) is not None else "").replace("\n", " ")[:w[c]].ljust(w[c]) for c in cols))
'
}

# Never print an email address. Who added it is a display name, or the fact
# that they have not registered yet.
WHO="case when a.had_profile then coalesce(p.display_name,'(left)') else '(still registering)' end as who"

case "${1:-new}" in
  show)
    [ -z "${2:-}" ] && { echo "Which one? bash tools/additions.sh show <id>"; exit 1; }
    run "select a.id, a.created_at, a.kind, a.entity_id, a.name, a.city, a.region,
                a.country, a.country_code, ${WHO}, a.status, a.member_note, a.review_note
           from public.catalogue_additions a
           left join public.profiles p on p.id = a.added_by
          where a.id = ${2};"
    echo
    echo "  postings now attached:"
    run "select count(*) as postings from public.postings
          where school_id = (select entity_id from public.catalogue_additions where id = ${2} and kind='school');"
    ;;
  near)
    [ -z "${2:-}" ] && { echo "Which one? bash tools/additions.sh near <id>"; exit 1; }
    # The Choueifat test: does something very like it already exist? A trailing
    # ", Lahore" was all it took for school_name_key() to miss a real duplicate.
    run "with a as (select name, country from public.catalogue_additions where id = ${2})
         select s.id, s.name, s.city, s.country, s.is_verified,
                (select count(*) from public.postings po where po.school_id = s.id) as postings
           from public.schools s, a
          where s.country = a.country
            and (public.school_name_key(s.name) like '%'||public.school_name_key(a.name)||'%'
              or public.school_name_key(a.name) like '%'||public.school_name_key(s.name)||'%')
          order by s.is_verified desc, s.id
          limit 12;"
    ;;
  ok|done)
    [ -z "${2:-}" ] && { echo "Which one? bash tools/additions.sh $1 <id> \"note\""; exit 1; }
    ST=$([ "$1" = "ok" ] && echo ok || echo corrected)
    NOTE=$(printf '%s' "${3:-}" | sed "s/'/''/g")
    run "update public.catalogue_additions
            set status='${ST}', reviewed_at=now(), review_note=nullif('${NOTE}','')
          where id=${2}
      returning id, kind, name, status;"
    ;;
  all)
    run "select a.id, a.created_at::date as added, a.kind, a.name, a.city, a.country,
                ${WHO}, a.status
           from public.catalogue_additions a
           left join public.profiles p on p.id = a.added_by
          order by a.created_at desc limit 100;"
    ;;
  *)
    echo "Waiting for review:"
    run "select a.id, to_char(a.created_at,'DD Mon HH24:MI') as added, a.kind, a.name,
                a.city, a.country, ${WHO},
                case when a.kind='school' then
                  (select count(*) from public.postings po where po.school_id = a.entity_id)::text
                  else '' end as postings,
                coalesce(a.member_note,'') as note
           from public.catalogue_additions a
           left join public.profiles p on p.id = a.added_by
          where a.status = 'new'
          order by a.created_at desc limit 50;"
    ;;
esac
