#!/bin/bash
# Stamp js/config.js with the build time, shown in the app header.
#
# GitHub Pages caches JS for ~10 minutes, so without a visible stamp there is no
# way to tell whether a browser has picked up a deploy — which cost us two rounds
# of debugging code that was no longer live.
#
# Deliberately a TIMESTAMP, not a commit hash: stamping with HEAD then committing
# produces a new hash, so the stamp would always name the previous commit.
#
# Run before committing:  bash tools/stamp-build.sh
set -e
cd "$(dirname "$0")/.."
python3 - "$(date -u '+%d %b %H:%M UTC')" <<'PY'
import re, sys
stamp = sys.argv[1]
p = 'js/config.js'
s = open(p).read()
s = re.sub(r"export const BUILD = '[^']*';", f"export const BUILD = '{stamp}';", s)
open(p, 'w').write(s)
print('stamped:', stamp)
PY
