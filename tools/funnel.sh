#!/bin/bash
# 6 Degrees — how far people get when they register, and where they stop.
#
#   bash tools/funnel.sh            the funnel, and who is stuck where
#   bash tools/funnel.sh stuck      just the people who have not finished
#
# On 20 Sep 2026 fourteen people had signed in and never finished. That was
# discovered by counting rows by hand, and the two causes that were found were
# found only because those people happened to leave wreckage behind. This makes
# the drop-off visible without an archaeologist.
#
# Emails are always masked. Nobody but Paul can read any of this.
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
w = {c: min(56, max(len(c), *(len(str(r.get(c) if r.get(c) is not None else "")) for r in rows))) for c in cols}
print("  " + "  ".join(c.ljust(w[c]) for c in cols))
print("  " + "  ".join("-" * w[c] for c in cols))
for r in rows:
    print("  " + "  ".join(str(r.get(c) if r.get(c) is not None else "").replace("\n"," ")[:w[c]].ljust(w[c]) for c in cols))
'
}

# Everybody who has ever signed in, and the furthest step they reached.
# Anyone with a profile finished, whether or not the marker was recorded —
# people registered before this table existed.
BASE="with people as (
  select u.id,
         left(u.email,2)||'***@'||split_part(u.email,'@',2) as who,
         u.created_at, u.last_sign_in_at,
         (p.id is not null) as registered,
         coalesce(g.furthest, 0) as furthest,
         coalesce(g.step_name, '-') as step_name
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.registration_progress g on g.user_id = u.id
   where u.last_sign_in_at is not null
)"

case "${1:-all}" in
  stuck)
    run "${BASE}
         select who, created_at::date as invited,
                to_char(last_sign_in_at,'DD Mon HH24:MI') as last_in,
                case furthest when 0 then 'signed in only'
                              when 1 then '1 opened the form'
                              when 2 then '2 typed their name'
                              when 3 then '3 picked a school'
                              when 4 then '4 dated a posting'
                              when 5 then '5 pressed save'
                              else '6 finished' end as got_as_far_as
           from people where not registered
          order by furthest desc, last_sign_in_at desc;"
    ;;
  *)
    echo "The funnel — everyone who has ever signed in:"
    echo "(steps are recorded from build 20 Sep 10:xx UTC; anyone here before that"
    echo " shows as 'signed in only' whether or not they opened the form)"
    run "${BASE}
         select case when registered then '6 finished'
                     else case furthest when 0 then '0 signed in only'
                                        when 1 then '1 opened the form'
                                        when 2 then '2 typed their name'
                                        when 3 then '3 picked a school'
                                        when 4 then '4 dated a posting'
                                        when 5 then '5 pressed save'
                                        else '6 finished' end end as step,
                count(*) as people
           from people group by 1 order by 1;"
    echo
    echo "Not finished:"
    run "${BASE}
         select who, to_char(last_sign_in_at,'DD Mon HH24:MI') as last_in,
                case furthest when 0 then 'signed in only'
                              when 1 then 'opened the form'
                              when 2 then 'typed their name'
                              when 3 then 'picked a school'
                              when 4 then 'dated a posting'
                              when 5 then 'pressed save' end as got_as_far_as
           from people where not registered
          order by furthest desc, last_sign_in_at desc limit 40;"
    ;;
esac
