#!/usr/bin/env bash
# Deterministic application tracking + review math for the UI and manual workflows (wraps ui/scripts/apps.ts).
#   scripts/apps.sh               usage
#   scripts/apps.sh check --link <url>
#   scripts/apps.sh today
# Runs from any directory; relative file arguments are resolved from where you call it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UI="$ROOT/ui"

if [[ ! -x "$UI/node_modules/.bin/tsx" ]]; then
  echo "Installing UI dependencies (one time)…" >&2
  (cd "$UI" && npm install --silent >&2)
fi

CAREER_ROOT="$ROOT" exec "$UI/node_modules/.bin/tsx" "$UI/scripts/apps.ts" "$@"
