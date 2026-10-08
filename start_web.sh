#!/bin/bash
# Run the browser UI without building or opening Electron.
SCRIPT_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd)" || exit 1
exec /bin/bash "$SCRIPT_DIR/start.sh" --web
