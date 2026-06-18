#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
HARNESS_DIR="$ROOT_DIR/docs/quality/2026-06-18-user-test/harness-probe"
EVIDENCE_DIR="$HARNESS_DIR/evidence"
APP_BIN="${TAURI_APP:-$ROOT_DIR/src-tauri/target/debug/keepance}"
VITE_PORT="${VITE_PORT:-5173}"
TAURI_DRIVER_PORT="${TAURI_DRIVER_PORT:-4514}"
TAURI_NATIVE_PORT="${TAURI_NATIVE_PORT:-4515}"
WEBKIT_DRIVER="${WEBKIT_DRIVER:-/usr/bin/WebKitWebDriver}"

mkdir -p "$EVIDENCE_DIR"

LOG_FILE="$EVIDENCE_DIR/probe.log"
SCREENSHOT_FILE="$EVIDENCE_DIR/workspace-shell.png"
TMPROOT="$(mktemp -d /tmp/keepance-real-app.XXXXXX)"
APP_HOME="$TMPROOT/home"
XDG_DATA_HOME_DIR="$TMPROOT/xdg-data"
XDG_CONFIG_HOME_DIR="$TMPROOT/xdg-config"
XDG_CACHE_HOME_DIR="$TMPROOT/xdg-cache"
PROBE_WORKSPACE="$TMPROOT/workspace"

mkdir -p "$APP_HOME" "$XDG_DATA_HOME_DIR" "$XDG_CONFIG_HOME_DIR" "$XDG_CACHE_HOME_DIR" "$PROBE_WORKSPACE"
printf 'Desktop backend probe\n' > "$PROBE_WORKSPACE/probe.md"

VITE_PID=""
DRIVER_PID=""

cleanup() {
  if [[ -n "$DRIVER_PID" ]]; then
    kill "$DRIVER_PID" 2>/dev/null || true
    wait "$DRIVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

exec > >(tee "$LOG_FILE") 2>&1

echo "== Keepance real desktop harness probe =="
date -u +"UTC %Y-%m-%dT%H:%M:%SZ"
echo "root: $ROOT_DIR"
echo "app: $APP_BIN"
echo "tmp: $TMPROOT"
echo "workspace: $PROBE_WORKSPACE"
echo "screenshot: $SCREENSHOT_FILE"

if [[ ! -x "$APP_BIN" ]]; then
  echo "ERROR: app binary is not executable: $APP_BIN" >&2
  exit 1
fi

if ! command -v tauri-driver >/dev/null 2>&1; then
  echo "ERROR: tauri-driver is missing. Install it with: cargo install tauri-driver --locked" >&2
  exit 1
fi

if [[ ! -x "$WEBKIT_DRIVER" ]]; then
  echo "ERROR: WebKitWebDriver is not executable: $WEBKIT_DRIVER" >&2
  exit 1
fi

echo
echo "== Tool versions =="
tauri-driver --help | sed -n '1,8p'
"$WEBKIT_DRIVER" --help | sed -n '1,8p'

echo
echo "== Vite dev server =="
if curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:$VITE_PORT/" | grep -q '<title>Keepance</title>'; then
    echo "Reusing existing Keepance Vite server on 127.0.0.1:$VITE_PORT"
  else
    echo "ERROR: port $VITE_PORT is in use, but it does not look like Keepance." >&2
    exit 1
  fi
else
  echo "Starting Vite on 127.0.0.1:$VITE_PORT"
  (
    cd "$ROOT_DIR"
    npm run dev -- --host 127.0.0.1 --port "$VITE_PORT"
  ) > "$EVIDENCE_DIR/vite.log" 2>&1 &
  VITE_PID="$!"

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done

  if ! curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
    echo "ERROR: Vite did not become ready. See $EVIDENCE_DIR/vite.log" >&2
    exit 1
  fi
fi

echo
echo "== Tauri WebDriver =="
echo "Starting tauri-driver on $TAURI_DRIVER_PORT with native WebKitWebDriver on $TAURI_NATIVE_PORT"
xvfb-run -a --server-args='-screen 0 1366x900x24' env \
  HOME="$APP_HOME" \
  XDG_DATA_HOME="$XDG_DATA_HOME_DIR" \
  XDG_CONFIG_HOME="$XDG_CONFIG_HOME_DIR" \
  XDG_CACHE_HOME="$XDG_CACHE_HOME_DIR" \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  GDK_BACKEND=x11 \
  tauri-driver \
    --port "$TAURI_DRIVER_PORT" \
    --native-port "$TAURI_NATIVE_PORT" \
    --native-driver "$WEBKIT_DRIVER" \
  > "$EVIDENCE_DIR/tauri-driver.log" 2>&1 &
DRIVER_PID="$!"

for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$TAURI_DRIVER_PORT/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -fsS "http://127.0.0.1:$TAURI_DRIVER_PORT/status" >/dev/null 2>&1; then
  echo "ERROR: tauri-driver did not become ready. See $EVIDENCE_DIR/tauri-driver.log" >&2
  exit 1
fi

echo
echo "== WebDriver assertion run =="
TAURI_APP="$APP_BIN" \
TAURI_DRIVER_PORT="$TAURI_DRIVER_PORT" \
PROBE_SCREENSHOT="$SCREENSHOT_FILE" \
PROBE_WORKSPACE="$PROBE_WORKSPACE" \
node "$HARNESS_DIR/driver.mjs"

echo
echo "Evidence written:"
echo "- $LOG_FILE"
echo "- $SCREENSHOT_FILE"
echo "- $EVIDENCE_DIR/tauri-driver.log"
if [[ -n "$VITE_PID" ]]; then
  echo "- $EVIDENCE_DIR/vite.log"
fi
