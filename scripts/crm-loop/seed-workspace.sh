#!/usr/bin/env bash
# Create a reusable CRM workspace fixture through the real desktop store.
set -euo pipefail

TARGET="${1:?usage: scripts/crm-loop/seed-workspace.sh <empty-directory>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$(mkdir -p "$TARGET" && cd "$TARGET" && pwd)"

if find "$TARGET" -mindepth 1 -print -quit | grep -q .; then
  echo "Refusing to replace a non-empty fixture directory: $TARGET" >&2
  exit 2
fi

find_free_port() {
  node -e "const net=require('node:net'); const s=net.createServer(); s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}
PORT="${LANTERN_DEV_BRIDGE_PORT:-$(find_free_port)}"
LOG="${TMPDIR:-/tmp}/lantern-crm-seed-${PORT}.log"
APP_PID=""
cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill -TERM "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$ROOT"
LANTERN_TEST_MODE=1 LANTERN_DEV_BRIDGE_PORT="$PORT" CRM_LOOP_WORKSPACE="$TARGET" \
  bash scripts/crm-loop/launch-app.sh "$PORT" "$TARGET" >"$LOG" 2>&1 &
APP_PID="$!"

for _ in $(seq 1 200); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null; then
    LANTERN_DEV_BRIDGE_PORT="$PORT" CRM_LOOP_WORKSPACE="$TARGET" \
      node scripts/crm-loop/seed-workspace.mjs
    echo "Fixture ready: $TARGET"
    exit 0
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    cat "$LOG" >&2
    exit 1
  fi
  sleep 0.1
done

echo "Timed out waiting for the desktop app; log: $LOG" >&2
exit 1
