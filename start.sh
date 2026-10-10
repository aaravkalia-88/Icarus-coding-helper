#!/bin/bash
# Build and run Icarus in this terminal. Use Ctrl+C or ./stop.sh to close it.
# Bash job control gives npm and its descendants a separate process group,
# including when this script runs without an interactive terminal.
if [[ -z "${BASH_VERSION:-}" ]]; then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.icarus-start.pid"
app_pid=""
launcher_command="/bin/bash $SCRIPT_DIR/start.sh"
npm_args=(run start)
if [[ "${1:-}" == --web ]]; then
  PID_FILE="$SCRIPT_DIR/.icarus-web.pid"
  launcher_command+=" --web"
  npm_args=(run dev -- --host 127.0.0.1 --port 5173 --strictPort)
fi

# Use a consistent absolute command so stop.sh can verify the launcher's identity.
if [[ "$0" != "$SCRIPT_DIR/start.sh" || "$BASH" != /bin/bash ]]; then
  exec /bin/bash "$SCRIPT_DIR/start.sh" "$@"
fi

cd "$SCRIPT_DIR/frontend"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to start Icarus." >&2
  exit 127
fi

is_pid() {
  # Reject PID 0 (the current process group), PID 1, signs, and leading zeros.
  [[ "$1" =~ ^[1-9][0-9]*$ && "$1" != 1 ]]
}

is_launcher() {
  is_pid "$1" && kill -0 "$1" 2>/dev/null &&
    [[ "$(ps -p "$1" -o command= 2>/dev/null)" == "$launcher_command" ]]
}

cleanup() {
  # EXIT handles normal completion, failed builds, and both signal traps.
  # Signal the entire group: killing only npm leaves Electron/backend alive.
  trap '' INT TERM
  if [[ -n "$app_pid" ]]; then
    kill -TERM -- "-$app_pid" 2>/dev/null || true
    for ((attempt = 0; attempt < 50; attempt++)); do
      kill -0 -- "-$app_pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 -- "-$app_pid" 2>/dev/null; then
      echo "Icarus did not stop within 5 seconds; forcing remaining processes..."
      kill -KILL -- "-$app_pid" 2>/dev/null || true
    fi
    wait "$app_pid" 2>/dev/null || true
  fi

  # A duplicate invocation must never remove another launcher's PID file.
  if [[ "$(cat "$PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f -- "$PID_FILE"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Exclusive file creation prevents simultaneous launches from both winning.
# Store this supervisor's PID; it stays alive until child cleanup is finished.
owns_pid_file=false
for ((attempt = 0; attempt < 20; attempt++)); do
  if (set -o noclobber; printf '%s\n' "$$" > "$PID_FILE") 2>/dev/null; then
    owns_pid_file=true
    break
  fi

  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_launcher "$existing_pid"; then
    echo "Icarus is already running (launcher pid $existing_pid)."
    exit 0
  fi
  # Give a concurrent writer one second before treating an empty file as stale.
  if [[ -z "$existing_pid" ]]; then
    sleep 0.1
    if ((attempt < 10)); then
      continue
    fi
  fi
  # Stale/invalid records are disposable; never signal their recorded process.
  if [[ "$(cat "$PID_FILE" 2>/dev/null || true)" == "$existing_pid" ]]; then
    rm -f -- "$PID_FILE"
  fi
done
if [[ "$owns_pid_file" != true ]]; then
  echo "Could not claim the Icarus PID file. Check $PID_FILE and retry." >&2
  exit 1
fi

set -m
if [[ "${1:-}" == --web ]]; then
  echo "Starting Icarus web at http://localhost:5173. Use Ctrl+C or ./stop_web.sh to stop."
fi
(
  if [[ "${1:-}" != --web && -z "${ICARUS_PYTHON:-}" && -z "${VIRTUAL_ENV:-}" ]]; then
    if [[ ! -x "$SCRIPT_DIR/.venv/bin/python3" ]]; then
      echo "Creating Icarus Python environment..."
      python3 -m venv "$SCRIPT_DIR/.venv"
    fi
    export ICARUS_PYTHON="$SCRIPT_DIR/.venv/bin/python3"
    if ! "$ICARUS_PYTHON" -c 'import fastapi, httpx, uvicorn' >/dev/null 2>&1; then
      echo "Installing Icarus backend dependencies..."
      "$ICARUS_PYTHON" -m pip install -r "$SCRIPT_DIR/backend/requirements.txt"
    fi
  fi
  exec npm "${npm_args[@]}"
) &
app_pid=$!

# Keep the real npm exit code while allowing EXIT cleanup after a failed build.
# Avoid 'status': it is a read-only variable when executing the old zsh version.
exit_code=0
wait "$app_pid" || exit_code=$?
exit "$exit_code"
