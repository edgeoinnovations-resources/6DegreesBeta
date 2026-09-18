#!/bin/bash
# 6 Degrees — back up everything that cannot be rebuilt from the migrations.
#
#   bash tools/backup.sh              # write a dated backup outside the repo
#   bash tools/backup.sh --list       # show the backups you already have
#
# WHY THIS EXISTS. The Supabase free tier gives no downloadable backups, and the
# database holds seven real people's career histories. `supabase db dump` needs
# Docker, which is not installed here, so this goes through the authenticated CLI
# instead — no Docker, no database password.
#
# WHAT IT SAVES. Only what is irreplaceable:
#   profiles, postings, connection_tags, notes, privacy_settings, invites,
#   member-added schools, member-added cities, client_errors
# colleagueships and shared_contexts are DERIVED and deliberately skipped: after a
# restore, `select public.recompute_all();` rebuilds them exactly. The 2,120
# catalogue schools and the city gazetteer come from the migrations.
#
# WHERE IT GOES. ~/6DegreesBackups, NEVER the repo — the repo is public and this
# file contains real names, real career histories and real email addresses. The
# script refuses to write anywhere inside the working tree, and chmods the result
# to 600.
set -e
cd "$(dirname "$0")/.."
REPO="$(pwd -P)"
SB="${SUPABASE_BIN:-$HOME/.local/bin/supabase}"
DEST="${SIXDEG_BACKUP_DIR:-$HOME/6DegreesBackups}"

if [ "$1" = "--list" ]; then
  echo "Backups in $DEST:"
  ls -1t "$DEST" 2>/dev/null | head -20 || echo "  (none yet)"
  exit 0
fi

# Refuse to write inside the repo, however the destination was set.
case "$(cd "$(dirname "$DEST")" 2>/dev/null && pwd -P || echo /)/$(basename "$DEST")" in
  "$REPO"|"$REPO"/*)
    echo "REFUSING: $DEST is inside the repo, which is public. Set SIXDEG_BACKUP_DIR elsewhere."
    exit 1 ;;
esac

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT="$DEST/$STAMP"
mkdir -p "$OUT"
chmod 700 "$DEST" "$OUT"

# Each table to a JSON file. `db query` returns a JSON envelope; keep only rows.
dump() {
  local name="$1" sql="$2"
  "$SB" db query "$sql" --linked 2>/dev/null | python3 -c '
import json, sys, pathlib
raw = sys.stdin.read()
try:
    d, _ = json.JSONDecoder().raw_decode(raw[raw.index("{"):])
except Exception:
    print("QUERY_FAILED"); sys.exit(1)
rows = d.get("rows") or []
p = pathlib.Path(sys.argv[1])
p.write_text(json.dumps(rows, indent=2, ensure_ascii=False, default=str))
print(len(rows))
' "$OUT/$name.json"
}

echo "Backing up to $OUT"
total=0
fail=0
add() {
  local name="$1" sql="$2"
  local n
  n=$(dump "$name" "$sql" || echo QUERY_FAILED)
  if [ "$n" = "QUERY_FAILED" ] || [ -z "$n" ]; then
    echo "  FAIL  $name"; fail=$((fail+1))
  else
    # Row counts only. Never print the contents: these tables hold real names
    # and real email addresses.
    echo "  ok    $name ($n)"; total=$((total+n))
  fi
}

add profiles          "select * from public.profiles order by created_at;"
add postings          "select * from public.postings order by profile_id, start_date;"
add connection_tags   "select * from public.connection_tags order by created_at;"
add notes             "select * from public.notes order by id;"
add privacy_settings  "select * from public.privacy_settings order by profile_id;"
add invites           "select * from public.invites order by created_at;"
add schools_member    "select * from public.schools where added_by is not null order by id;"
add cities_member     "select * from public.cities where population = 0 order by id;"
add client_errors     "select * from public.client_errors order by created_at;"

cat > "$OUT/RESTORE.md" <<'EOF'
# Restoring this backup

Each file is the full contents of one table as a JSON array.

1. Recreate the schema from the repo: `supabase db push` against an empty project.
   That rebuilds the catalogue schools, the city gazetteer, tag types and regions.
2. Restore the auth users FIRST. They are not in here — Supabase owns
   `auth.users` and the CLI cannot read it. Recreate them from `invites.json`
   (the email addresses) by inviting each person again; each person signs in once
   and gets a NEW id.
3. **Profile ids are auth user ids.** If step 2 produced new ids, every
   `profile_id` / `requester_id` / `subject_id` / `added_by` in these files has to
   be remapped from the old id to the new one before loading. Match people by
   `first_name` + `last_name` in `profiles.json`.
4. Load profiles, then privacy_settings, then schools_member and cities_member,
   then postings, then connection_tags, then notes.
5. Rebuild the derived graph: `select public.recompute_all();`
   That regenerates colleagueships and shared_contexts, which are not backed up
   because they are computed from postings.

## What this does NOT cover
- `auth.users` and anyone's sign-in state. See step 2.
- The Supabase project settings: SMTP, redirect URLs, rate limits.
- Storage buckets (none are in use).

## Handle with care
`invites.json` and `profiles.json` contain real email addresses and real names.
Keep this directory off the public repo and off shared drives.
EOF

chmod -R 600 "$OUT"/*.json "$OUT/RESTORE.md"
echo
if [ "$fail" -gt 0 ]; then
  echo "$fail table(s) failed — the backup is INCOMPLETE. Do not rely on it."
  exit 1
fi
echo "Done: $total rows in $(ls -1 "$OUT" | wc -l | tr -d ' ') files, mode 600, at"
echo "  $OUT"
