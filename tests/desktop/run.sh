#!/usr/bin/env bash
#
# run.sh — run the L2 "real desktop app" test suite headless on Linux.
#
# Drives the REAL Tauri (Rust) Keepance app via tauri-driver + WebKitWebDriver +
# xvfb, with a FRESH isolated profile per spec (temp HOME/XDG/workspace), so the
# OS keychain fallback, ~/.keepance, and WebKit profile never touch the real home
# dir and specs can't contaminate each other.
#
# Usage:
#   tests/desktop/run.sh                 # run every spec in specs/ (sorted)
#   tests/desktop/run.sh 00 mail         # run only specs whose filename matches any arg
#
# Requires (all already present on this server):
#   - src-tauri/target/debug/keepance   (build with: npm run tauri build -- --debug, or reuse)
#   - tauri-driver                       (cargo install tauri-driver --locked)
#   - /usr/bin/WebKitWebDriver, xvfb-run, node, a Keepance Vite server on :5173
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/tests/desktop"
SPECS_DIR="$DESKTOP_DIR/specs"
EVIDENCE_DIR="$DESKTOP_DIR/evidence"
APP_BIN="${TAURI_APP:-$ROOT_DIR/src-tauri/target/debug/keepance}"
VITE_PORT="${VITE_PORT:-5173}"
TAURI_DRIVER_PORT="${TAURI_DRIVER_PORT:-4514}"
TAURI_NATIVE_PORT="${TAURI_NATIVE_PORT:-4515}"
WEBKIT_DRIVER="${WEBKIT_DRIVER:-/usr/bin/WebKitWebDriver}"

mkdir -p "$EVIDENCE_DIR"

# --- preflight -------------------------------------------------------------
[[ -x "$APP_BIN" ]] || { echo "ERROR: app binary not executable: $APP_BIN" >&2; exit 1; }
command -v tauri-driver >/dev/null || { echo "ERROR: tauri-driver missing (cargo install tauri-driver --locked)" >&2; exit 1; }
[[ -x "$WEBKIT_DRIVER" ]] || { echo "ERROR: WebKitWebDriver not executable: $WEBKIT_DRIVER" >&2; exit 1; }
command -v xvfb-run >/dev/null || { echo "ERROR: xvfb-run missing" >&2; exit 1; }

# --- shared Vite (frontend) ------------------------------------------------
VITE_PID=""
if curl -fsS "http://127.0.0.1:$VITE_PORT/" 2>/dev/null | grep -q '<title>Keepance</title>'; then
  echo "Reusing Keepance Vite on :$VITE_PORT"
else
  if curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
    echo "ERROR: :$VITE_PORT in use but not Keepance" >&2; exit 1
  fi
  echo "Starting Vite on :$VITE_PORT"
  ( cd "$ROOT_DIR" && npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" ) > "$EVIDENCE_DIR/vite.log" 2>&1 &
  VITE_PID="$!"
  for _ in $(seq 1 160); do curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -fsS "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1 || { echo "ERROR: Vite not ready (see $EVIDENCE_DIR/vite.log)" >&2; exit 1; }
fi

cleanup_vite() { [[ -n "$VITE_PID" ]] && { kill "$VITE_PID" 2>/dev/null || true; wait "$VITE_PID" 2>/dev/null || true; }; }
trap cleanup_vite EXIT

# --- select specs ----------------------------------------------------------
mapfile -t ALL_SPECS < <(find "$SPECS_DIR" -maxdepth 1 -name '*.mjs' | sort)
SPECS=()
if [[ $# -eq 0 ]]; then
  SPECS=("${ALL_SPECS[@]}")
else
  for s in "${ALL_SPECS[@]}"; do
    for pat in "$@"; do [[ "$(basename "$s")" == *"$pat"* ]] && { SPECS+=("$s"); break; }; done
  done
fi
[[ ${#SPECS[@]} -gt 0 ]] || { echo "No specs matched." >&2; exit 1; }

echo "Running ${#SPECS[@]} spec(s) against $APP_BIN"
echo

PASS=0; FAIL=0; FAILED_NAMES=()

for SPEC in "${SPECS[@]}"; do
  NAME="$(basename "$SPEC")"
  TMPROOT="$(mktemp -d /tmp/keepance-l2.XXXXXX)"
  WORKSPACE="$TMPROOT/workspace"
  mkdir -p "$TMPROOT/home" "$TMPROOT/xdg-data" "$TMPROOT/xdg-config" "$TMPROOT/xdg-cache" "$WORKSPACE"

  # tauri-driver inherits this env (and passes it to the app it spawns), giving
  # each spec a fully isolated profile.
  DRIVER_LOG="$EVIDENCE_DIR/${NAME}.tauri-driver.log"
  xvfb-run -a --server-args='-screen 0 1366x900x24' env \
    HOME="$TMPROOT/home" \
    XDG_DATA_HOME="$TMPROOT/xdg-data" \
    XDG_CONFIG_HOME="$TMPROOT/xdg-config" \
    XDG_CACHE_HOME="$TMPROOT/xdg-cache" \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    GDK_BACKEND=x11 \
    tauri-driver --port "$TAURI_DRIVER_PORT" --native-port "$TAURI_NATIVE_PORT" --native-driver "$WEBKIT_DRIVER" \
    > "$DRIVER_LOG" 2>&1 &
  DRIVER_PID="$!"

  ready=""
  for _ in $(seq 1 120); do
    curl -fsS "http://127.0.0.1:$TAURI_DRIVER_PORT/status" >/dev/null 2>&1 && { ready=1; break; }
    sleep 0.25
  done

  if [[ -z "$ready" ]]; then
    echo "FAIL $NAME (tauri-driver did not start; see $DRIVER_LOG)"
    FAIL=$((FAIL+1)); FAILED_NAMES+=("$NAME")
  else
    set +e
    TAURI_APP="$APP_BIN" \
    TAURI_DRIVER_PORT="$TAURI_DRIVER_PORT" \
    KP_WORKSPACE="$WORKSPACE" \
    KP_TMPROOT="$TMPROOT" \
    KP_EVIDENCE_DIR="$EVIDENCE_DIR" \
    KP_SPEC="$SPEC" \
    node "$DESKTOP_DIR/harness/runner.mjs"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); FAILED_NAMES+=("$NAME"); fi
  fi

  kill "$DRIVER_PID" 2>/dev/null || true
  wait "$DRIVER_PID" 2>/dev/null || true
  rm -rf "$TMPROOT"
  echo
done

echo "================ L2 desktop suite ================"
echo "PASS: $PASS   FAIL: $FAIL"
[[ $FAIL -gt 0 ]] && printf 'Failed: %s\n' "${FAILED_NAMES[*]}"
echo "Evidence: $EVIDENCE_DIR"
exit $(( FAIL > 0 ? 1 : 0 ))
