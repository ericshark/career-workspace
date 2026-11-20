#!/usr/bin/env bash
# The only resume build entry point. The driver checks and stages every required operation.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
command -v python3 >/dev/null || { echo '✗ missing tool: python3' >&2; exit 1; }
exec python3 "$ROOT/scripts/resume_build.py" "$@"
