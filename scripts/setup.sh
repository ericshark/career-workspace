#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Install Node.js 24 or newer."); process.exit(1) }'
npm ci --prefix ui
node scripts/init-workspace.mjs
