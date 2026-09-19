#!/bin/bash
# 6 Degrees — what members have reported going wrong.
#
#   bash tools/issues.sh                 open reports, newest first
#   bash tools/issues.sh all             include resolved ones
#   bash tools/issues.sh show <id>       one report in full, with its context
#   bash tools/issues.sh shot <id>       download its screenshot
#   bash tools/issues.sh resolve <id> "what fixed it"
#
# Companion to tools/errors.sh. That one catches exceptions; this one catches
# everything that does not throw — a school in the wrong city, a connection that
# makes no sense, a button that does nothing. Read both at the start of a session.
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
w = {c: min(70, max(len(c), *(len(str(r.get(c) if r.get(c) is not None else "")) for r in rows))) for c in cols}
print("  " + "  ".join(c.ljust(w[c]) for c in cols))
print("  " + "  ".join("-" * w[c] for c in cols))
for r in rows:
    print("  " + "  ".join(str(r.get(c) if r.get(c) is not None else "").replace("\n", " ")[:w[c]].ljust(w[c]) for c in cols))
'
}

case "${1:-open}" in
  show)
    [ -z "${2:-}" ] && { echo "Which one? bash tools/issues.sh show <id>"; exit 1; }
    "$SB" db query "select * from public.issue_reports where id = ${2};" --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
rows = d.get("rows") or []
if not rows: print("  no report with that id"); sys.exit(0)
r = rows[0]
print(f"\n  Issue #{r[\"id\"]}   {r[\"created_at\"]}   [{r[\"status\"]}]")
print(f"  screen {r.get(\"view\") or \"?\"} · build {r.get(\"build\") or \"?\"} · window {r.get(\"window_size\") or \"?\"}")
print(f"  {r.get(\"user_agent\") or \"\"}")
print("\n  ── what they said ──")
for line in (r.get("note") or "").splitlines(): print(f"    {line}")
if r.get("screenshot"):
    print(f"\n  screenshot: {r[\"screenshot\"]}")
    print(f"    bash tools/issues.sh shot {r[\"id\"]}")
errs = r.get("recent_errors") or []
if errs:
    print("\n  ── logged in the 30 minutes before ──")
    for e in errs:
        print(f"    {e.get(\"created_at\",\"\")[:19]}  {e.get(\"view\",\"\")}  {e.get(\"action\",\"\")}  {e.get(\"message\",\"\")[:80]}")
if r.get("resolution"): print(f"\n  resolved: {r[\"resolution\"]}")
print()
'
    ;;
  shot)
    [ -z "${2:-}" ] && { echo "Which one? bash tools/issues.sh shot <id>"; exit 1; }
    OBJ=$("$SB" db query "select screenshot from public.issue_reports where id = ${2};" --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read(); d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
rows = d.get("rows") or []
print((rows[0].get("screenshot") or "") if rows else "")')
    if [ -z "$OBJ" ]; then echo "  no screenshot on that report"; exit 0; fi
    OUT="${TMPDIR:-/tmp}/6deg-issue-${2}-$(basename "$OBJ")"
    echo "  Screenshots live in a private bucket and are downloaded from the dashboard:"
    echo "    https://supabase.com/dashboard/project/tyukcebfecdwnnbrjbvr/storage/buckets/issue-screenshots"
    echo "  object: $OBJ"
    echo "  (they contain other members' names and histories — keep them off the repo)"
    ;;
  resolve)
    [ -z "${2:-}" ] && { echo "Usage: bash tools/issues.sh resolve <id> \"what fixed it\""; exit 1; }
    run "update public.issue_reports
            set status = 'resolved', resolved_at = now(), resolution = $(python3 -c "
import sys; print(\"'\" + (sys.argv[1] if len(sys.argv)>1 else '').replace(\"'\",\"''\") + \"'\")" "${3:-fixed}")
          where id = ${2}
        returning id, status, resolution;"
    ;;
  all)
    echo "Every report:"
    run "select * from ops.issue_summary;"
    ;;
  *)
    echo "Open reports from members:"
    run "select * from ops.issue_summary where status = 'open';"
    echo
    echo "  bash tools/issues.sh show <id>      the whole thing, with context"
    echo "  bash tools/issues.sh resolve <id> \"what fixed it\""
    ;;
esac
