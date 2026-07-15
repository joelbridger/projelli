#!/usr/bin/env bash
# Run the packaged restart proof for the 4 record-depth lanes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE="$ROOT/evidence/2026-07-15-tranche1-batch"
LOG="$EVIDENCE/records-drive.log"
EXPECTED_SHA="a6952a0acfe39d82b0375fcbd6be2ffd16d0b230"
BINARY="${1:?usage: run-records-drive.sh <exact-binary> <clean-workspace>}"
WORKSPACE="${2:?usage: run-records-drive.sh <exact-binary> <clean-workspace>}"
PORT="${LANTERN_DEV_BRIDGE_PORT:-9296}"
DISPLAY_ID="${LANTERN_XVFB_DISPLAY:-:146}"
APP_PID_FILE="$WORKSPACE/app.pid"
XVFB_PID_FILE="$WORKSPACE/xvfb.pid"
LAUNCHER_PID=""
VITE_PID=""
EXPECTED_BINARY_SHA="${TRANCHE1_EXPECTED_BINARY_SHA:-}"

mkdir -p "$EVIDENCE"
if [ "${TRANCHE1_RECORDS_LOG_ACTIVE:-}" != "1" ]; then
  : >"$LOG"
  exec env TRANCHE1_RECORDS_LOG_ACTIVE=1 "$0" "$@" \
    > >(sed -u 's/[[:space:]]\+$//' | tee "$LOG") 2>&1
fi

if [ "${TRANCHE1_RECORDS_PRIVATE_DBUS:-}" != "1" ]; then
  exec dbus-run-session -- env TRANCHE1_RECORDS_PRIVATE_DBUS=1 "$0" "$@"
fi

fail() { echo "FAIL records restart drive: $*" >&2; exit 1; }

[ -z "$(git -C "$ROOT" diff --name-only "$EXPECTED_SHA" -- . ':(exclude)evidence/2026-07-15-tranche1-batch')" ] || fail "product source differs from $EXPECTED_SHA"
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=all -- . ':(exclude)evidence/2026-07-15-tranche1-batch')" ] || fail "product source has uncommitted changes"
[ -x "$BINARY" ] || fail "exact binary is missing"
if [ -n "$EXPECTED_BINARY_SHA" ]; then
  [ "$(sha256sum "$BINARY" | awk '{print $1}')" = "$EXPECTED_BINARY_SHA" ] || fail "binary hash changed"
fi
mkdir -p "$WORKSPACE"
if find "$WORKSPACE" -mindepth 1 -print -quit | grep -q .; then
  fail "workspace must be empty: $WORKSPACE"
fi

export XDG_CONFIG_HOME="$WORKSPACE/.config"
export XDG_DATA_HOME="$WORKSPACE/.data"
export XDG_CACHE_HOME="$WORKSPACE/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

eval "$(printf '\n' | gnome-keyring-daemon --unlock --components=secrets)"

stop_app() {
  if [ -n "$LAUNCHER_PID" ] && kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    kill -TERM "$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  LAUNCHER_PID=""
  local deadline=$((SECONDS + 15))
  while curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || fail "old app bridge did not stop"
    sleep 0.1
  done
}
stop_vite() {
  if [ -n "$VITE_PID" ] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill -TERM "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  VITE_PID=""
  pkill -TERM -f "$ROOT/node_modules/.bin/vite" 2>/dev/null || true
}
cleanup() { stop_app; stop_vite; }
trap cleanup EXIT INT TERM

start_vite() {
  if curl -sf http://127.0.0.1:5174 >/dev/null 2>&1; then
    fail "port 5174 is already in use; refusing an unverified frontend"
  fi
  (
    cd "$ROOT"
    npm run dev -- --host 127.0.0.1
  ) >"$WORKSPACE/vite.log" 2>&1 &
  VITE_PID="$!"
  local deadline=$((SECONDS + 45))
  until curl -sf http://127.0.0.1:5174 >/dev/null 2>&1; do
    kill -0 "$VITE_PID" 2>/dev/null || fail "verified frontend stopped early"
    [ "$SECONDS" -lt "$deadline" ] || fail "verified frontend timed out"
    sleep 0.1
  done
}

launch_app() {
  local number="$1"
  DISPLAY= \
  LANTERN_APP_BINARY="$BINARY" \
  LANTERN_APP_PID_FILE="$APP_PID_FILE" \
  LANTERN_XVFB_PID_FILE="$XVFB_PID_FILE" \
  LANTERN_XVFB_DISPLAY="$DISPLAY_ID" \
    "$ROOT/scripts/crm-loop/launch-app.sh" "$PORT" "$WORKSPACE" \
      >"$WORKSPACE/app-launch-$number.log" 2>&1 &
  LAUNCHER_PID="$!"
  local deadline=$((SECONDS + 45))
  until curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
    kill -0 "$LAUNCHER_PID" 2>/dev/null || fail "app launch $number stopped early"
    [ "$SECONDS" -lt "$deadline" ] || fail "app launch $number timed out"
    sleep 0.1
  done
}

drive_phase() {
  local phase="$1"
  DISPLAY="$DISPLAY_ID" \
  LANTERN_DEV_BRIDGE_PORT="$PORT" \
  CRM_LOOP_WORKSPACE="$WORKSPACE" \
  TRANCHE1_EVIDENCE_DIR="$EVIDENCE" \
    node "$EVIDENCE/records-drive.mjs" "$phase"
}

echo "BUILD source_sha=$EXPECTED_SHA binary_sha256=$(sha256sum "$BINARY" | awk '{print $1}')"

start_vite
launch_app 1
drive_phase enter
stop_app
echo "RESTART old process and bridge fully stopped"

launch_app 2
drive_phase verify-after-restart
stop_app

echo "PASS packaged records restart drive: enter -> restart -> verify rehydrated"
