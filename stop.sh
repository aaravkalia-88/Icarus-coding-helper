#!/bin/bash
# Run from any directory to stop the app started by this project's start.sh.
if [[ -z "${BASH_VERSION:-}" ]]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.icarus-start.pid"
launcher_command="/bin/bash $SCRIPT_DIR/start.sh"
if [[ "${1:-}" == --web ]]; then
  PID_FILE="$SCRIPT_DIR/.icarus-web.pid"
  launcher_command+=" --web"
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "Icarus is not running. Nothing to stop."
  exit 0
fi

target_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
# Never pass zero, negative numbers, or malformed text to kill.
if [[ ! "$target_pid" =~ ^[1-9][0-9]*$ || "$target_pid" == 1 ]]; then
  rm -f -- "$PID_FILE"
  echo "Removed invalid Icarus PID file." >&2
  exit 1
fi
if ! kill -0 "$target_pid" 2>/dev/null; then
  rm -f -- "$PID_FILE"
  echo "Removed stale Icarus PID file. Nothing to stop."
  exit 0
fi

# A saved PID may have been reused. Verify its command before sending a signal.
if [[ "$(ps -p "$target_pid" -o command= 2>/dev/null)" != "$launcher_command" ]]; then
  rm -f -- "$PID_FILE"
  echo "PID $target_pid is not this project's Icarus launcher; refused to stop it." >&2
  exit 1
fi

echo "Stopping Icarus (launcher pid $target_pid)..."
# The launcher's TERM trap performs the same group cleanup as Ctrl+C.
# It retains the PID file until graceful shutdown or forced cleanup finishes.
if ! kill -TERM "$target_pid" 2>/dev/null; then
  echo "Could not signal the Icarus launcher. Retry the stop script." >&2
  exit 1
fi
for ((attempt = 0; attempt < 100; attempt++)); do
  if [[ "$(cat "$PID_FILE" 2>/dev/null || true)" != "$target_pid" ]]; then
    echo "Stopped."
    exit 0
  fi
  sleep 0.1
done

# Keep the record and report failure if the supervisor has not finished cleanup.
echo "Icarus has not finished stopping. Retry the stop script or check the startup terminal." >&2
exit 1
