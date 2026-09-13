#!/bin/bash
# Write the current commit into js/config.js so the running build is identifiable
# in the UI. Run before committing.
cd "$(dirname "$0")/.."
H=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
D=$(date -u +%H:%M)
perl -pi -e "s/export const BUILD = '[^']*';/export const BUILD = '\$H \$D UTC';/" js/config.js
grep -n "export const BUILD" js/config.js
