#!/usr/bin/env bash
# Run the packaged Trash & recovery restart proof with a private real keychain.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EVIDENCE="$ROOT/evidence/2026-07-15-trash-recovery"
EXPECTED_SHA="5c78629e27f2a886e5b041b6736d779c24216c5f"
EXPECTED_BINARY_SHA="fbb244d6b54847d0f4c3e26d38539dad1e22c6662f663703ab641a038df1a791"
BINARY="${1:?usage: run-drive.sh <exact-binary> <clean-workspace>}"
WORKSPACE="${2:?usage: run-drive.sh <exact-binary> <clean-workspace>}"
PORT="${LANTERN_DEV_BRIDGE_PORT:-9293}"
DISPLAY_ID="${LANTERN_XVFB_DISPLAY:-:143}"
APP_PID_FILE="$WORKSPACE/app.pid"
XVFB_PID_FILE="$WORKSPACE/xvfb.pid"
LAUNCHER_PID=""

fail() { echo "FAIL packaged restart drive: $*" >&2; exit 1; }

[ "$(git -C "$ROOT" rev-parse HEAD)" = "$EXPECTED_SHA" ] || fail "source tip changed"
[ -x "$BINARY" ] || fail "exact binary is missing"
[ "$(sha256sum "$BINARY" | awk '{print $1}')" = "$EXPECTED_BINARY_SHA" ] || fail "binary hash changed"
mkdir -p "$WORKSPACE" "$EVIDENCE"
if find "$WORKSPACE" -mindepth 1 -print -quit | grep -q .; then
  fail "workspace must be empty: $WORKSPACE"
fi

export XDG_CONFIG_HOME="$WORKSPACE/.config"
export XDG_DATA_HOME="$WORKSPACE/.data"
export XDG_CACHE_HOME="$WORKSPACE/.cache"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"

# This is not a key bypass. It starts the normal Secret Service keychain on
# this private D-Bus session, unlocked only for this temporary test workspace.
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

cleanup() { stop_app; }
trap cleanup EXIT INT TERM

launch_app() {
  local number="$1"
  LANTERN_APP_BINARY="$BINARY" \
  LANTERN_APP_PID_FILE="$APP_PID_FILE" \
  LANTERN_XVFB_PID_FILE="$XVFB_PID_FILE" \
  LANTERN_XVFB_DISPLAY="$DISPLAY_ID" \
    "$ROOT/scripts/crm-loop/launch-app.sh" "$PORT" "$WORKSPACE" \
      >"$EVIDENCE/app-launch-$number.log" 2>&1 &
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
  CRM_TRASH_EVIDENCE_DIR="$EVIDENCE" \
    node "$EVIDENCE/drive.mjs" "$phase"
}

echo "BUILD source_sha=$EXPECTED_SHA binary_sha256=$EXPECTED_BINARY_SHA"
echo "KEYCHAIN private Secret Service session; normal encrypted audit-store path"

launch_app 1
drive_phase delete
stop_app
echo "RESTART 1 old process and bridge fully stopped"

launch_app 2
drive_phase recover-after-restart
stop_app
echo "RESTART 2 old process and bridge fully stopped"

launch_app 3
drive_phase verify-restored-after-restart
stop_app

echo "PASS packaged restart drive: delete -> trash -> restart -> recover -> restart -> restored"
