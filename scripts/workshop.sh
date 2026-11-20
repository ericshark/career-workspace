#!/usr/bin/env bash
# Add and update Workshop ideas and projects from chat (wraps ui/scripts/workshop.ts).
#   scripts/workshop.sh               usage
#   scripts/workshop.sh find "title"
# Writes go through the same locked store as the UI. Runs from any directory.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI="$ROOT/ui"

if [[ ! -x "$UI/node_modules/.bin/tsx" ]]; then
  echo "Installing UI dependencies (one time)…" >&2
  (cd "$UI" && npm install --silent >&2)
fi

CAREER_ROOT="$ROOT" exec "$UI/node_modules/.bin/tsx" --tsconfig "$UI/tsconfig.json" "$UI/scripts/workshop.ts" "$@"
