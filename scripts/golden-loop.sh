#!/usr/bin/env bash
# Drive one real Lantern create -> restart -> persistence loop in a clean app.
#
# Usage:
#   scripts/golden-loop.sh <source-repo> <exact-debug-binary>
# Or set GOLDEN_LOOP_REPO and GOLDEN_LOOP_BINARY explicitly.
set -Eeuo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO="$(cd "$HERE/.." && pwd)"
REPO="${1:-${GOLDEN_LOOP_REPO:-$DEFAULT_REPO}}"
APP_BINARY="${2:-${GOLDEN_LOOP_BINARY:-}}"
LAUNCHER="${GOLDEN_LOOP_LAUNCHER:-$HERE/golden-loop-launch-app.sh}"
DRIVER="${GOLDEN_LOOP_DRIVER:-$HERE/golden-loop-driver.mjs}"
DEFAULT_DIAGNOSTIC_WRITER="$HERE/write-golden-loop-diagnostic.mjs"
DIAGNOSTIC_WRITER="${GOLDEN_LOOP_DIAGNOSTIC_WRITER:-$DEFAULT_DIAGNOSTIC_WRITER}"
TIMEOUT_SECONDS="${GOLDEN_LOOP_TIMEOUT_SECONDS:-150}"
TEMP_ROOT=""
WORKSPACE=""
APP_PID_FILE=""
XVFB_PID_FILE=""
APP_LOG=""
DOCUMENT_NAME=""
BRIDGE_PORT=""
DEV_URL=""
DEV_HOST=""
DEV_PORT=""
TIP_SHA=""
VITE_PID=""
APP_PID=""
XVFB_PID=""
DIAGNOSTIC_PHASE="preflight"
DIAGNOSTIC_WRITER_READY=0
ERROR_TRAP_ACTIVE=0

emit_diagnostic() {
  if [ "$DIAGNOSTIC_WRITER_READY" -eq 1 ]; then
    if node "$DIAGNOSTIC_WRITER" "$DIAGNOSTIC_PHASE" >&2; then
      return 0
    fi
    if [ "$DIAGNOSTIC_WRITER" != "$DEFAULT_DIAGNOSTIC_WRITER" ] \
      && node "$DEFAULT_DIAGNOSTIC_WRITER" --validate >/dev/null 2>&1 \
      && node "$DEFAULT_DIAGNOSTIC_WRITER" "$DIAGNOSTIC_PHASE" >&2; then
      echo 'GOLDEN LOOP DIAGNOSTIC PRIMARY WRITER FAILED; SAFE FALLBACK PRESERVED' >&2
      return 0
    fi
    echo 'GOLDEN LOOP DIAGNOSTIC FAILED' >&2
  else
    echo 'GOLDEN LOOP DIAGNOSTIC UNAVAILABLE' >&2
  fi
}

fail() {
  echo "GOLDEN LOOP FAILED: $*" >&2
  emit_diagnostic
  exit 1
}

on_error() {
  local status=$?
  [ "$status" -ne 0 ] || return 0
  if [ "$ERROR_TRAP_ACTIVE" -eq 0 ]; then
    ERROR_TRAP_ACTIVE=1
    echo "GOLDEN LOOP FAILED: unexpected command failure during $DIAGNOSTIC_PHASE" >&2
    emit_diagnostic
  fi
  exit "$status"
}

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
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  local end=$((SECONDS + 8))
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$end" ]; do sleep 0.1; done
  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- golden-loop launcher log ---" >&2
    [ -z "$APP_LOG" ] || cat "$APP_LOG" >&2 2>/dev/null || true
    echo "--- golden-loop app log (last 120 lines) ---" >&2
    [ -z "$WORKSPACE" ] || tail -120 "$WORKSPACE/app.log" >&2 2>/dev/null || true
    echo "--- golden-loop screen-server log (last 120 lines) ---" >&2
    [ -z "$TEMP_ROOT" ] || tail -120 "$TEMP_ROOT/vite.log" >&2 2>/dev/null || true
  fi
  stop_pid "$APP_PID"
  stop_pid "$VITE_PID"
  if [ -n "$XVFB_PID_FILE" ] && [ -s "$XVFB_PID_FILE" ]; then
    XVFB_PID="$(cat "$XVFB_PID_FILE" 2>/dev/null || true)"
    stop_pid "$XVFB_PID"
  fi
  [ -z "$TEMP_ROOT" ] || rm -rf "$TEMP_ROOT"
}
trap on_error ERR
trap cleanup EXIT INT TERM

if node "$DIAGNOSTIC_WRITER" --validate >/dev/null 2>&1; then
  DIAGNOSTIC_WRITER_READY=1
elif [ "$DIAGNOSTIC_WRITER" != "$DEFAULT_DIAGNOSTIC_WRITER" ] \
  && node "$DEFAULT_DIAGNOSTIC_WRITER" --validate >/dev/null 2>&1; then
  DIAGNOSTIC_WRITER="$DEFAULT_DIAGNOSTIC_WRITER"
  DIAGNOSTIC_WRITER_READY=1
  DIAGNOSTIC_PHASE="diagnostic-writer-validation"
  fail "configured diagnostic writer did not pass validation"
else
  fail "diagnostic writer did not pass validation"
fi

DIAGNOSTIC_PHASE="directory-creation"
if ! TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/lantern-golden-loop.XXXXXX")"; then
  fail "could not create the temporary golden-loop directory"
fi
WORKSPACE="$TEMP_ROOT/workspace"
APP_PID_FILE="$TEMP_ROOT/app.pid"
XVFB_PID_FILE="$TEMP_ROOT/xvfb.pid"
APP_LOG="$TEMP_ROOT/launcher.log"

export XDG_CONFIG_HOME="$TEMP_ROOT/xdg-config"
export XDG_DATA_HOME="$TEMP_ROOT/xdg-data"
export XDG_CACHE_HOME="$TEMP_ROOT/xdg-cache"
DIAGNOSTIC_PHASE="preflight"
DOCUMENT_NAME="golden-loop-$(date +%s)-$$"

wait_for_http() {
  local label="$1" url="$2" end=$((SECONDS + TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$end" ]; do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then return 0; fi
    if [ -n "$APP_PID" ] && ! kill -0 "$APP_PID" 2>/dev/null; then
      [ "$DIAGNOSTIC_PHASE" = "restart" ] || DIAGNOSTIC_PHASE="app-exit"
      fail "$label stopped before it became ready"
    fi
    if [ -n "$VITE_PID" ] && ! kill -0 "$VITE_PID" 2>/dev/null; then
      [ "$DIAGNOSTIC_PHASE" = "restart" ] || DIAGNOSTIC_PHASE="vite-startup"
      fail "$label screen server stopped before it became ready"
    fi
    sleep 0.2
  done
  fail "timed out waiting for $label at $url"
}

read_dev_url() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const config = JSON.parse(fs.readFileSync(path.join(process.argv[1], "src-tauri/tauri.conf.json"), "utf8"));
    const value = config?.build?.devUrl;
    if (typeof value !== "string" || value.length === 0) process.exit(2);
    process.stdout.write(value);
  ' "$1" || fail "could not read the desktop dev URL from $1/src-tauri/tauri.conf.json"
}

launch_app() {
  local launch_phase="${1:-launcher}"
  DIAGNOSTIC_PHASE="$launch_phase"
  if ! rm -f "$APP_PID_FILE"; then
    fail "could not clear the previous app process id"
  fi
  if ! LANTERN_GOLDEN_LOOP_DIAGNOSTICS=1 \
       LANTERN_APP_PID_FILE="$APP_PID_FILE" \
       LANTERN_XVFB_PID_FILE="$XVFB_PID_FILE" \
       LANTERN_EXPECTED_DEV_URL="$DEV_URL" \
       "$LAUNCHER" "$BRIDGE_PORT" "$WORKSPACE" "$APP_BINARY" "$REPO" "$TIP_SHA" \
       >"$APP_LOG" 2>&1; then
    cat "$APP_LOG" >&2 2>/dev/null || true
    fail "app launcher rejected the requested binary or could not start it"
  fi
  [ -s "$APP_PID_FILE" ] || {
    cat "$APP_LOG" >&2 2>/dev/null || true
    fail "app launcher did not provide an app process id"
  }
  [ "$launch_phase" = "restart" ] || DIAGNOSTIC_PHASE="pid-read"
  if ! APP_PID="$(cat "$APP_PID_FILE")"; then
    fail "could not read the app process id"
  fi
  if ! [[ "$APP_PID" =~ ^[1-9][0-9]*$ ]]; then
    fail "app launcher provided an invalid process id"
  fi
}

[ -d "$REPO" ] || fail "repo does not exist: $REPO"
[ -n "$APP_BINARY" ] || fail "no binary was supplied; pass it as argument 2 or set GOLDEN_LOOP_BINARY"
[ -x "$LAUNCHER" ] || fail "app launcher is missing or not executable: $LAUNCHER"
[ -f "$DRIVER" ] || fail "Documents driver is missing: $DRIVER"
[ -d "$REPO/node_modules" ] || fail "dependencies are missing in $REPO"
TIP_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || fail "could not read the requested tip SHA"
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] \
  || fail "requested repo has tracked changes, so it is not an exact tip: $REPO"

DEV_URL="$(read_dev_url "$REPO")"
readarray -t DEV_PARTS < <(node -e '
  const url = new URL(process.argv[1]);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || !url.port) process.exit(2);
  console.log(url.hostname);
  console.log(url.port);
' "$DEV_URL") || fail "desktop dev URL must be an explicit localhost HTTP port: $DEV_URL"
DEV_HOST="${DEV_PARTS[0]:-}"
DEV_PORT="${DEV_PARTS[1]:-}"
if [ -z "$DEV_HOST" ] || [ -z "$DEV_PORT" ]; then
  fail "could not parse desktop dev URL: $DEV_URL"
fi

if curl --silent --fail "$DEV_URL" >/dev/null 2>&1; then
  fail "$DEV_URL is already serving an app; stop it so this loop can own the exact screen source"
fi
# Positional parameters intentionally expand inside the child bash process.
# shellcheck disable=SC2016
DIAGNOSTIC_PHASE="vite-startup"
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=300 \
  setsid bash -c 'cd "$1" && exec npm run dev -- --host "$2" --port "$3" --strictPort' \
  _ "$REPO" "$DEV_HOST" "$DEV_PORT" >"$TEMP_ROOT/vite.log" 2>&1 &
VITE_PID=$!
wait_for_http "the matching app screen server" "$DEV_URL"

DIAGNOSTIC_PHASE="port-selection"
if ! BRIDGE_PORT="$(free_port)"; then
  fail "could not select a free bridge port"
fi
DIAGNOSTIC_PHASE="directory-creation"
if ! mkdir -p "$WORKSPACE"; then
  fail "could not create the golden-loop workspace"
fi
echo "golden loop provenance: source_sha=$TIP_SHA binary=$APP_BINARY dev_url=$DEV_URL"
launch_app launcher
DIAGNOSTIC_PHASE="bridge-health"
wait_for_http "the desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"

echo "golden loop: workspace=$WORKSPACE bridge=$BRIDGE_PORT document=$DOCUMENT_NAME.docx"
DIAGNOSTIC_PHASE="driver-startup"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
GOLDEN_LOOP_DEV_URL="$DEV_URL" \
  node "$DRIVER" write "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME" \
  || fail "the golden-loop write driver failed"

stop_pid "$APP_PID"
APP_PID=""
DIAGNOSTIC_PHASE="restart"
launch_app restart
wait_for_http "the restarted desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
GOLDEN_LOOP_DEV_URL="$DEV_URL" \
  node "$DRIVER" assert "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME" \
  || fail "the golden-loop restart driver failed"

echo "GOLDEN LOOP PASS: real Documents create/save/restart/persistence verified."
