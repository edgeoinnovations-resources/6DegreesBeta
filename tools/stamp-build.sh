#!/bin/bash
# Write the current commit + time into js/config.js, so the running build is
# identifiable in the UI. GitHub Pages caches JS for ~10 minutes, so without this
# there is no way to tell whether a browser has picked up a deploy.
#
# Run before committing:  bash tools/stamp-build.sh
set -e
cd "$(dirname "$0")/.."
H=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
D=$(date -u +%H:%M)
python3 - "$H" "$D" <<'PY'
import re, sys
h, d = sys.argv[1], sys.argv[2]
p = 'js/config.js'
s = open(p).read()
s = re.sub(r"export const BUILD = '[^']*';",
           f"export const BUILD = '{h} · {d} UTC';", s)
open(p, 'w').write(s)
print(f"stamped: {h} · {d} UTC")
PY
