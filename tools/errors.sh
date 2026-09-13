#!/bin/bash
# Review the client error log. Start every working session with this.
#
#   bash tools/errors.sh              open errors, grouped and counted
#   bash tools/errors.sh recent [N]   the last N raw errors (default 20)
#   bash tools/errors.sh code 23503   every open occurrence of one code
#   bash tools/errors.sh resolve 23503 "what fixed it"
#                                     mark all open errors with that code resolved
#
# The log is written by the app (see js/supabaseClient.js, logError) and is
# write-only to members — reading it needs the linked CLI.
set -e
cd "$(dirname "$0")/.."
SB="${SUPABASE_BIN:-$HOME/.local/bin/supabase}"

run() {
  "$SB" db query "$1" --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw[raw.index("{"):])
except Exception:
    print(raw.strip()[:500]); sys.exit(1)
rows = d.get("rows") or []
if not rows:
    print("  (nothing)"); sys.exit(0)
cols = list(rows[0].keys())
w = {c: min(60, max(len(c), *(len(str(r.get(c) or "")) for r in rows))) for c in cols}
print("  " + "  ".join(c.ljust(w[c]) for c in cols))
print("  " + "  ".join("-" * w[c] for c in cols))
for r in rows:
    print("  " + "  ".join(str(r.get(c) if r.get(c) is not None else "").replace("\n", " ")[:w[c]].ljust(w[c]) for c in cols))
'
}

case "${1:-summary}" in
  summary)
    echo "Open errors (grouped):"
    run "select code, action, occurrences as n, people, signed_out as anon,
                to_char(last_seen,'DD Mon HH24:MI') as last_seen, builds, message
           from ops.error_summary limit 50;"
    ;;
  recent)
    N="${2:-20}"
    run "select to_char(created_at,'DD Mon HH24:MI:SS') as at, view, action, code,
                (user_id is null) as anon, build, left(message,120) as message
           from public.client_errors order by created_at desc limit ${N//[^0-9]/};"
    ;;
  code)
    C="${2//\'/}"
    run "select to_char(created_at,'DD Mon HH24:MI:SS') as at, view, action, build, path,
                left(message,200) as message, left(stack,300) as stack
           from public.client_errors where code = '$C' and resolved_at is null
          order by created_at desc limit 30;"
    ;;
  resolve)
    C="${2//\'/}"; R="${3//\'/}"
    [ -z "$C" ] && { echo "usage: errors.sh resolve <code> \"what fixed it\""; exit 1; }
    # A window function is not allowed in RETURNING, so count through a CTE.
    run "with u as (update public.client_errors set resolved_at = now(), resolution = '$R'
                     where code = '$C' and resolved_at is null returning 1)
         select count(*) as resolved from u;"
    ;;
  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
