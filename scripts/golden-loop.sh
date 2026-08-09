#!/usr/bin/env bash
# golden-loop.sh — drive one real Lantern core loop in a clean, headless app.
#
# It is intentionally a gate, not a demo helper: failure to launch, missing
# driver handles, a save failure, or lost data after restart all exit nonzero.
#
# Usage:
#   scripts/golden-loop.sh [repo-containing-the-prebuilt-build]
#
# Defaults to this Lantern-Plus checkout.  To check the assembled UX build:
#   scripts/golden-loop.sh /home/jameson/lp-ux-integrate
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LANTERN_PLUS_ROOT="$(cd "$HERE/.." && pwd)"
REPO="${1:-${GOLDEN_LOOP_REPO:-$LANTERN_PLUS_ROOT}}"
LAUNCHER="${GOLDEN_LOOP_LAUNCHER:-/home/jameson/lantern-coordination/coordinator/tools/launch-app.sh}"
DRIVER="$HERE/golden-loop-driver.mjs"
# A headless Linux run has no answer for the native folder picker.  The app's
# own safety fallback appears after its 90-second picker watchdog, so leave
# enough room for that real path plus the actual document checks.
TIMEOUT_SECONDS="${GOLDEN_LOOP_TIMEOUT_SECONDS:-150}"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lantern-golden-loop.XXXXXX")"
WORKSPACE="$TEMP_ROOT/workspace"
APP_PID_FILE="$TEMP_ROOT/app.pid"
APP_LOG="$TEMP_ROOT/launcher.log"
DOCUMENT_NAME="golden-loop-$(date +%s)-$$"
BRIDGE_PORT=""
VITE_PID=""
APP_PID=""
APP_BINARY="${GOLDEN_LOOP_BINARY:-}"

# The desktop web view keeps browser storage outside the workspace.  Give this
# gate its own temporary profile so an operator's remembered workspace can
# never trigger auto-reopen before the driver prepares its clean test path.
export XDG_CONFIG_HOME="$TEMP_ROOT/xdg-config"
export XDG_DATA_HOME="$TEMP_ROOT/xdg-data"
export XDG_CACHE_HOME="$TEMP_ROOT/xdg-cache"

fail() { echo "GOLDEN LOOP FAILED: $*" >&2; exit 1; }

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
}

stop_pid() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  # Vite is launched in its own session.  Stop that whole small family, not
  # merely npm's wrapper process, or its node child would leak and make the
  # next gate accidentally test a stale checkout.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local end=$((SECONDS + 8))
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$end" ]; do sleep 0.1; done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- golden-loop app log (last 120 lines) ---" >&2
    tail -120 "$WORKSPACE/app.log" >&2 2>/dev/null || true
    echo "--- golden-loop screen-server log (last 120 lines) ---" >&2
    tail -120 "$TEMP_ROOT/vite.log" >&2 2>/dev/null || true
  fi
  stop_pid "$APP_PID"
  stop_pid "$VITE_PID"
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT INT TERM

wait_for_http() {
  local label="$1" url="$2" end=$((SECONDS + TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$end" ]; do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then return 0; fi
    # The launcher returns after handing the GUI process off; checking its
    # pid makes an early crash a useful failure rather than a long timeout.
    if [ -n "$APP_PID" ] && ! kill -0 "$APP_PID" 2>/dev/null; then
      tail -80 "$WORKSPACE/app.log" >&2 2>/dev/null || true
      fail "$label stopped before it became ready"
    fi
    if [ -n "$VITE_PID" ] && ! kill -0 "$VITE_PID" 2>/dev/null; then
      tail -120 "$TEMP_ROOT/vite.log" >&2 2>/dev/null || true
      fail "$label screen server stopped before it became ready"
    fi
    sleep 0.2
  done
  tail -80 "$WORKSPACE/app.log" >&2 2>/dev/null || true
  fail "timed out waiting for $label"
}

launch_app() {
  if [ -n "$APP_BINARY" ]; then
    LANTERN_APP_PID_FILE="$APP_PID_FILE" "$LAUNCHER" "$BRIDGE_PORT" "$WORKSPACE" "$APP_BINARY" >"$APP_LOG" 2>&1
  else
    LANTERN_APP_PID_FILE="$APP_PID_FILE" "$LAUNCHER" "$BRIDGE_PORT" "$WORKSPACE" >"$APP_LOG" 2>&1
  fi
}

[ -d "$REPO" ] || fail "repo does not exist: $REPO"
[ -x "$LAUNCHER" ] || fail "app launcher is missing or not executable: $LAUNCHER"
[ -f "$DRIVER" ] || fail "Documents driver is missing: $DRIVER"
[ -d "$REPO/node_modules" ] || fail "dependencies are missing in $REPO"

# The debug desktop binary is wired to Vite's fixed dev URL.  Own that server
# for this run so a coincidental server from a different checkout cannot turn
# the gate green with the wrong app.  This never compiles the desktop binary.
if curl --silent --fail http://127.0.0.1:5173 >/dev/null 2>&1; then
  fail "port 5173 is already serving an app; stop it so this gate can verify the requested build"
fi
# This server is only a temporary source of the exact screen code.  On this
# shared QA machine many concurrent app jobs can exhaust Linux's tiny pool of
# inotify *instances*, which makes Vite die after serving its first page.  Its
# polling mode avoids that unrelated machine-wide limit.  Bind to the same
# localhost name the desktop shell uses in tauri.conf.json (rather than merely
# proving that curl can reach 127.0.0.1).
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=300 \
  setsid bash -c 'cd "$1" && exec npm run dev -- --host localhost --port 5173 --strictPort' _ "$REPO" >"$TEMP_ROOT/vite.log" 2>&1 &
VITE_PID=$!
wait_for_http "the matching app screen server" "http://localhost:5173"

BRIDGE_PORT="$(free_port)"
mkdir -p "$WORKSPACE"
launch_app
[ -s "$APP_PID_FILE" ] || { cat "$APP_LOG" >&2; fail "app launcher did not provide an app process id"; }
APP_PID="$(cat "$APP_PID_FILE")"
wait_for_http "the desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"

echo "golden loop: workspace=$WORKSPACE bridge=$BRIDGE_PORT document=$DOCUMENT_NAME.docx"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
  node "$DRIVER" write "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME"

stop_pid "$APP_PID"
APP_PID=""
rm -f "$APP_PID_FILE"

launch_app
[ -s "$APP_PID_FILE" ] || { cat "$APP_LOG" >&2; fail "app launcher did not provide an app process id after restart"; }
APP_PID="$(cat "$APP_PID_FILE")"
wait_for_http "the restarted desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
  node "$DRIVER" assert "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME"

echo "GOLDEN LOOP PASS: real Documents create/save/restart/persistence verified."
