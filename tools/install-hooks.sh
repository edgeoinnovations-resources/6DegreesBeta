#!/bin/bash
# Installs a pre-commit hook that REFUSES to commit real people's data.
#
# Run once per clone:   bash tools/install-hooks.sh
#
# Why this exists on top of .gitignore: the repository is public and served by GitHub
# Pages, and .gitignore is only a default. `git add -f`, an edited .gitignore, or a
# well-meaning `git add -A` after someone drops a new export into the folder would all
# put private files on a public website. This hook is the backstop that cannot be
# defeated by accident. (Hooks are per-clone and not themselves version controlled,
# which is why this installer is committed instead.)

set -e
HOOK_DIR="$(git rev-parse --git-dir)/hooks"
mkdir -p "$HOOK_DIR"

cat > "$HOOK_DIR/pre-commit" <<'HOOK'
#!/bin/bash
# 6 Degrees — block real people's data from a public repo. See tools/install-hooks.sh.

# Patterns that must never be committed. Media is blocked everywhere EXCEPT assets/,
# which is the one reviewed location for deliberate site assets (logo, etc).
BLOCKED=$(git diff --cached --name-only --diff-filter=ACM | grep -E \
  -e '^WhatsApp Chat' \
  -e '^6 Degrees Meeting/' \
  -e '\.(opus|m4a|mp4|docx|pptx|heic)$' \
  -e '^(6 Degrees Meeting Agenda|6Degrees Mtg Slides|6-Degrees-Guide)\.pdf$' \
  -e '^6degrees_enrollment_form\.html$' \
  || true)

# Media outside assets/
MEDIA=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '\.(jpg|jpeg|png|gif|webp)$' | grep -v '^assets/' || true)

FOUND="$BLOCKED
$MEDIA"
FOUND=$(echo "$FOUND" | grep -v '^$' | sort -u || true)

if [ -n "$FOUND" ]; then
  echo ""
  echo "  COMMIT BLOCKED — these files contain (or may contain) real people's data,"
  echo "  and this repository is PUBLIC and served by GitHub Pages:"
  echo ""
  echo "$FOUND" | sed 's/^/      /'
  echo ""
  echo "  Unstage them:   git restore --staged <file>"
  echo "  Site assets belong in assets/ and must be reviewed before committing."
  echo "  To override deliberately (think first):   git commit --no-verify"
  echo ""
  exit 1
fi

# Second net: a real-looking email address in any staged text file. Demo data uses
# @6degrees.demo; the real members carry no email at all.
TEXT_FILES=$(git diff --cached --name-only --diff-filter=ACM \
  | grep -E '\.(json|js|html|md|csv|txt|py|css)$' || true)

LEAKED=""
if [ -n "$TEXT_FILES" ]; then
  for f in $TEXT_FILES; do
    [ -f "$f" ] || continue
    # Every match, not just the first: -m1 would stop at a legitimate @6degrees.demo
    # address and never see a real one further down the file.
    HIT=$(grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" 2>/dev/null \
      | grep -v '6degrees\.demo' | grep -v 'noreply@' | sort -u | head -3 | tr '\n' ' ' || true)
    [ -n "$HIT" ] && LEAKED="$LEAKED
  $f: $HIT"
  done
fi
LEAKED=$(echo "$LEAKED" | grep -v '^$' || true)

if [ -n "$LEAKED" ]; then
  echo ""
  echo "  COMMIT BLOCKED — a real-looking email address is staged:"
  echo ""
  echo "$LEAKED" | sed 's/^/    /'
  echo ""
  echo "  Demo data must use @6degrees.demo. Real members carry no email at all."
  echo "  To override deliberately:   git commit --no-verify"
  echo ""
  exit 1
fi

exit 0
HOOK

chmod +x "$HOOK_DIR/pre-commit"
echo "installed $HOOK_DIR/pre-commit"
