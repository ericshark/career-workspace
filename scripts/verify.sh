#!/usr/bin/env bash
# Run offline against starter data. Browser checks use a separate temporary workspace.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"
export TMPDIR="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
for script in scripts/*.sh; do bash -n "$script"; done
python3 scripts/test_build.py
for category in tech general datacenter hourly; do
  ./scripts/build.sh "source/$category/resume.tex"
done
TZ=America/New_York NEXT_PUBLIC_CAREER_DAY_TARGET=25 NEXT_PUBLIC_CAREER_WEEK_TARGET=125 npm test --prefix ui
npm run typecheck --prefix ui -- --incremental false
npm run format:check --prefix ui
npm run build --prefix ui
