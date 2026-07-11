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
#   npm run dev                 # vite on :5173
#   cargo build --manifest-path src-tauri/Cargo.toml   # produces the binary
set -euo pipefail

PORT="${1:?usage: launch-app.sh <bridge-port> <workspace-dir>}"
WORKSPACE="${2:?usage: launch-app.sh <bridge-port> <workspace-dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/lantern"

[ -x "$BIN" ] || {
  echo "No debug binary at $BIN — run: cargo build --manifest-path src-tauri/Cargo.toml" >&2
  exit 1
}
curl -sf "http://127.0.0.1:5173" >/dev/null || {
  echo "Vite is not serving on :5173 — run 'npm run dev' first (one server serves every instance)." >&2
  exit 1
}

mkdir -p "$WORKSPACE"
# Each instance gets its own config/data dirs so two seats never share a store.
export XDG_CONFIG_HOME="$WORKSPACE/.config"
export XDG_DATA_HOME="$WORKSPACE/.data"
export LANTERN_DEV_BRIDGE_PORT="$PORT"
export LANTERN_WORKSPACE_ROOT="$WORKSPACE"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"

echo "app instance: bridge=127.0.0.1:$PORT workspace=$WORKSPACE"
exec "$BIN"
