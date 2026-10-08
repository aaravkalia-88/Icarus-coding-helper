#!/bin/bash
# Stop only the browser server started by this project's start_web.sh.
SCRIPT_DIR="$(cd -P -- "$(dirname -- "$0")" && pwd)" || exit 1
exec /bin/bash "$SCRIPT_DIR/stop.sh" --web
