#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ui="$root/ui"
state="$ui/.cache/launcher.pid"
pid=""
port=""
if [[ -r "$state" ]]; then
  read -r pid port < "$state" || true
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || [[ $(ps -ww -p "$pid" -o command= 2>/dev/null || true) != *" $ui/scripts/serve.mjs "* ]]; then
    pid=""
  fi
fi
case "${1:-start}" in
  status)
    if [[ -n "$pid" ]]; then
      echo "Career Workspace launcher (PID $pid), http://127.0.0.1:$port"
    else
      echo "Career Workspace is not running."
    fi ;;
  stop)
    if [[ -z "$pid" ]]; then echo "Career Workspace is not running."; exit 0; fi
    kill -TERM "$pid"
    for _ in $(seq 1 30); do
      if ! kill -0 "$pid" 2>/dev/null; then echo "Stopped."; exit 0; fi
      sleep 0.25
    done
    echo "Launcher is still stopping."; exit 1 ;;
  start|dev|rebuild)
    [[ -z "$pid" ]] || { echo "Already running. Run $0 stop first."; exit 1; }
    [[ -d "$ui/node_modules" && -f "$root/records/applications.md" ]] ||
      { echo "Run ./scripts/setup.sh from the repository root first."; exit 1; }
    cd "$ui"
    export CAREER_TRACK_LAUNCHER=1
    exec node "$ui/scripts/serve.mjs" "${1:-start}" ;;
  *)
    echo "Usage: $0 [start|dev|rebuild|status|stop]" >&2; exit 2 ;;
esac
