#!/usr/bin/env bash
# Launch ONE app instance from the already-built debug binary.
#
# Why this exists: `npm run tauri:dev` compiles before it runs, and only one
# cargo compile fits on this box at a time — so every lane that wanted to drive
# the real app queued behind the compiler. The frontend dev server (vite) can
# serve any number of app instances, and the debug binary can be launched N
# times, so a single shared build unblocks all of them.
#
# Usage:
#   scripts/crm-loop/launch-app.sh <bridge-port> <workspace-dir>
# Example:
#   scripts/crm-loop/launch-app.sh 9252 /tmp/crm-seat-a
#
# Prereqs (start once, shared by every instance):
#   npm run dev                 # vite on :5174 (matches tauri.conf.json)
#   cargo build --manifest-path src-tauri/Cargo.toml   # produces the binary
set -euo pipefail

PORT="${1:?usage: launch-app.sh <bridge-port> <workspace-dir>}"
WORKSPACE="${2:?usage: launch-app.sh <bridge-port> <workspace-dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VITE_PORT="${LANTERN_VITE_PORT:-5174}"
BIN="${LANTERN_APP_BINARY:-$ROOT/src-tauri/target/debug/lantern}"
# A git worktree has its own source tree but can safely use the already-built
# debug binary from the primary checkout when it has not changed Rust code.
# This keeps live UI verification from starting an unnecessary cargo build.
if [ ! -x "$BIN" ]; then
  COMMON_GIT_DIR="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  PRIMARY_ROOT="${COMMON_GIT_DIR%/.git}"
  [ -n "$PRIMARY_ROOT" ] && [ -x "$PRIMARY_ROOT/src-tauri/target/debug/lantern" ] && BIN="$PRIMARY_ROOT/src-tauri/target/debug/lantern"
fi

[ -x "$BIN" ] || {
  echo "No debug binary at $BIN — run: cargo build --manifest-path src-tauri/Cargo.toml" >&2
  exit 1
}
curl -sf "http://127.0.0.1:${VITE_PORT}" >/dev/null || {
  echo "Vite is not serving on :${VITE_PORT} — start it before launching the app." >&2
  exit 1
}

# A GUI app needs a display. Agent shells have none, so give each instance its
# own virtual screen when DISPLAY is unset — this is what lets many lanes drive
# real app windows headlessly, in parallel.
XVFB_PID=""
if [ -z "${DISPLAY:-}" ]; then
  VDISP="${LANTERN_XVFB_DISPLAY:-:$((100 + PORT - 9250))}"
  if ! xdpyinfo -display "$VDISP" >/dev/null 2>&1; then
    Xvfb "$VDISP" -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
    XVFB_PID="$!"
    if [ -n "${LANTERN_XVFB_PID_FILE:-}" ]; then
      printf '%s\n' "$XVFB_PID" > "$LANTERN_XVFB_PID_FILE"
    fi
    deadline=$((SECONDS + 10))
    until xdpyinfo -display "$VDISP" >/dev/null 2>&1; do
      if ! kill -0 "$XVFB_PID" 2>/dev/null || [ "$SECONDS" -ge "$deadline" ]; then
        echo "Xvfb did not become ready on $VDISP" >&2
        exit 1
      fi
      # This polls the display's real readiness; it is not a fixed startup delay.
      sleep 0.1
    done
  fi
  export DISPLAY="$VDISP"
  echo "virtual display: $DISPLAY"
fi

mkdir -p "$WORKSPACE"
# Each instance gets its own config/data dirs so two seats never share a store.
export XDG_CONFIG_HOME="$WORKSPACE/.config"
export XDG_DATA_HOME="$WORKSPACE/.data"
export LANTERN_DEV_BRIDGE_PORT="$PORT"
export LANTERN_WORKSPACE_ROOT="$WORKSPACE"
# Automated desktop runs should exercise the real startup and persistence
# path, without a decorative welcome/tour layer swallowing their first click.
# The debug Tauri window reads this once before the renderer loads. Set it to
# 0 only when a test deliberately needs to cover first-run onboarding.
export LANTERN_TEST_MODE="${LANTERN_TEST_MODE:-1}"
# `launch-app.sh` is the headless, debug-only real-app harness.  Its virtual
# display has no desktop keychain service, so CRM SQLCipher's production
# keychain lookup can block indefinitely before the first record is opened.
# Give this harness its documented deterministic test key; release builds do
# not run through this script and still require the OS keychain.
export LANTERN_HEADLESS_TEST_CRM_CORE_MASTER_KEY_HEX="${LANTERN_HEADLESS_TEST_CRM_CORE_MASTER_KEY_HEX:-7f4ed0c8f58b2434a61d9ec2d6b5c3a1e9f8071625344b7ca09d1e2f3a4b5c6d}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"

echo "app instance: bridge=127.0.0.1:$PORT workspace=$WORKSPACE"
APP_PID=""
cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$XVFB_PID" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
    wait "$XVFB_PID" 2>/dev/null || true
  fi
  [ -z "${LANTERN_XVFB_PID_FILE:-}" ] || rm -f "$LANTERN_XVFB_PID_FILE"
}
trap cleanup EXIT INT TERM
"$BIN" &
APP_PID="$!"
[ -z "${LANTERN_APP_PID_FILE:-}" ] || printf '%s\n' "$APP_PID" > "$LANTERN_APP_PID_FILE"
wait "$APP_PID"
