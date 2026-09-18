#!/bin/bash
# 6 Degrees — one-command health check. Read-only: changes nothing.
#
#   bash tools/healthcheck.sh
#
# Run at the start of every maintenance session (see CLAUDE.md). Each section
# prints OK, WARN or FAIL with enough detail to act on.
cd "$(dirname "$0")/.."
SB="${SUPABASE_BIN:-$HOME/.local/bin/supabase}"
SITE="https://edgeoinnovations-resources.github.io/6DegreesBeta"
REF="tyukcebfecdwnnbrjbvr"
fails=0; warns=0
ok()   { echo "  OK    $*"; }
warn() { echo "  WARN  $*"; warns=$((warns+1)); }
fail() { echo "  FAIL  $*"; fails=$((fails+1)); }

# A count that came back non-numeric means the query itself failed — usually a
# second supabase command running at the same time. Reporting that as a data FAIL
# sent a whole session chasing duplicate schools that did not exist (18 Sep 2026).
counted() {
  case "$1" in ''|*[!0-9]*) warn "$2 could not be checked — the query returned no number"; return 1 ;; esac
  return 0
}

# Run SQL and print the first row's value for column $2 (or all rows with -a).
q1() {
  "$SB" db query "$1" --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
    rows = d.get("rows") or []
    print(rows[0].get(sys.argv[1], "") if rows else "QUERY_FAILED")
except Exception:
    print("QUERY_FAILED")
' "$2"
}

echo "== 1. Access =="
if ! "$SB" projects list -o json >/dev/null 2>&1; then
  fail "Supabase CLI not logged in. Paul must run '~/.local/bin/supabase login' in a real Terminal window (it needs a TTY)."
  echo; echo "Stopping: nothing else can be checked without access."; exit 1
fi
STATUS=$("$SB" projects list -o json 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read(); d, _ = json.JSONDecoder().raw_decode(raw[raw.index("["):])
print(next((p["status"] for p in d if p["ref"] == sys.argv[1]), "NOT_FOUND"))' "$REF")
case "$STATUS" in
  ACTIVE_HEALTHY) ok "project $REF is $STATUS" ;;
  *) fail "project $REF is $STATUS — free tier pauses after 7 days idle; Paul restores it from the dashboard" ;;
esac

echo; echo "== 2. Repo and deploy =="
git fetch -q origin 2>/dev/null
[ -z "$(git status --porcelain)" ] && ok "working tree clean" || warn "uncommitted changes: $(git status --porcelain | wc -l | tr -d ' ') files"
L=$(git rev-parse HEAD); R=$(git rev-parse origin/main 2>/dev/null)
[ "$L" = "$R" ] && ok "in sync with origin/main" || warn "local and origin/main differ — pull or push before working"
[ -x .git/hooks/pre-commit ] && ok "pre-commit privacy hook installed" || fail "pre-commit hook missing — run: bash tools/install-hooks.sh"
LOCAL_BUILD=$(grep -o "BUILD = '[^']*'" js/config.js | cut -d"'" -f2)
LIVE_BUILD=$(curl -s -H "Cache-Control: no-cache" "$SITE/js/config.js" | grep -o "BUILD = '[^']*'" | cut -d"'" -f2)
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SITE/")
[ "$CODE" = "200" ] && ok "site responds ($CODE)" || fail "site returned HTTP $CODE"
[ "$LOCAL_BUILD" = "$LIVE_BUILD" ] && ok "live build matches repo: $LIVE_BUILD" \
  || warn "live build '$LIVE_BUILD' differs from repo '$LOCAL_BUILD' (Pages caches ~10 min, or last commit not pushed)"

echo; echo "== 3. Migrations =="
PENDING=$("$SB" migration list --linked 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
    ms = d.get("migrations") or []
    print(sum(1 for m in ms if m.get("local") != m.get("remote")))
except Exception:
    print("?")')
[ "$PENDING" = "0" ] && ok "all migrations applied remotely" || warn "$PENDING migration(s) differ between local and remote"

echo; echo "== 4. Errors reported by members =="
OPEN=$(q1 "select count(*) as n from public.client_errors where resolved_at is null;" n)
LAST24=$(q1 "select count(*) as n from public.client_errors where created_at > now() - interval '24 hours';" n)
if ! counted "$OPEN" "open errors"; then :
elif [ "$OPEN" = "0" ]; then ok "no open errors"; else warn "$OPEN open error(s), $LAST24 in the last 24h — run: bash tools/errors.sh"; fi

echo; echo "== 5. Security advisors =="
# Findings accepted on 13 Sep 2026 (see CLAUDE.md, "Accepted advisor findings").
"$SB" db advisors --linked --type security 2>/dev/null | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
except Exception:
    print("  WARN  advisors could not be read"); sys.exit(0)
accepted = {
    ("authenticated_security_definer_function_executable", "save_my_profile"),
    ("authenticated_security_definer_function_executable", "ghost_me"),
    ("authenticated_security_definer_function_executable", "is_member"),
    ("auth_leaked_password_protection", "Auth"),
    ("anon_security_definer_function_executable", "rls_auto_enable"),
    ("authenticated_security_definer_function_executable", "rls_auto_enable"),
}
new = []
for r in d.get("results") or []:
    m = r.get("metadata") or {}
    key = (r["name"], m.get("name") or m.get("entity") or "")
    if key not in accepted:
        new.append(f"{r['level']} {key[0]} {key[1]}")
if new:
    print(f"  FAIL  {len(new)} NEW security finding(s):")
    for n in new: print(f"          {n}")
else:
    print("  OK    no security findings beyond the accepted baseline")
'

echo; echo "== 6. Data integrity =="
BAD_TIME=$(q1 "select count(*) as n from public.colleagueships
  where (degree % 2 = 1) <> (time_relation = 'same time')
     or (degree % 2 = 0 and coalesce(overlap_years,'') <> '')
     or (degree % 2 = 1 and coalesce(overlap_years,'') = '');" n)
counted "$BAD_TIME" "degree/time agreement" &&
  { [ "$BAD_TIME" = "0" ] && ok "every degree agrees with its time relation and overlap" \
  || fail "$BAD_TIME connection(s) whose degree contradicts its own time data — run: select public.recompute_all();"; }
DUPES=$(q1 "with n as (select id, country, public.school_name_key(name) k from public.schools)
  select count(*) as n from n a join n b on a.country=b.country and a.k=b.k and a.id<b.id;" n)
counted "$DUPES" "duplicate schools" &&
  { [ "$DUPES" = "0" ] && ok "no duplicate schools" \
  || fail "$DUPES duplicate school pair(s) — same-school colleagues will compute as degree 3 instead of 1"; }
UNREVIEWED=$(q1 "select count(*) as n from public.schools where added_by is not null and is_verified = false;" n)
counted "$UNREVIEWED" "member-added schools" &&
  { [ "$UNREVIEWED" = "0" ] && ok "no member-added schools awaiting review" \
  || warn "$UNREVIEWED member-added school(s) unverified — check spelling, city, and near-duplicates"; }
NOPOST=$(q1 "select count(*) as n from public.profiles p where status='active'
  and not exists (select 1 from public.postings x where x.profile_id=p.id);" n)
counted "$NOPOST" "members without postings" &&
  { [ "$NOPOST" = "0" ] && ok "every active member has at least one posting" || warn "$NOPOST active member(s) with no postings"; }

echo; echo "== 7. Membership =="
echo "  members $(q1 "select count(*) as n from public.profiles where status='active';" n)  ·  \
signed in but not registered $(q1 "select count(*) as n from auth.users u where not exists (select 1 from public.profiles p where p.id=u.id);" n)  ·  \
invited, never signed in $(q1 "select count(*) as n from public.invites where accepted_at is null;" n)  ·  \
pending tags $(q1 "select count(*) as n from public.connection_tags where status='pending';" n)  ·  \
confirmed tags $(q1 "select count(*) as n from public.connection_tags where status='approved';" n)"

echo; echo "== Summary: $fails fail, $warns warn =="
[ "$fails" -eq 0 ]
