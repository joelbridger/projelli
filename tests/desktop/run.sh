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

ensure_driver_ports_free() {
  local busy=0
  for port in "$TAURI_DRIVER_PORT" "$TAURI_NATIVE_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "ERROR: desktop harness port :$port is already in use; refusing to attach to a stale tauri-driver." >&2
      lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
      busy=1
    fi
  done
  [[ $busy -eq 0 ]] || exit 1
}

# Reap leftovers from a previously-killed L2 run before we start. The per-spec
# cleanup below stops new leaks, but a run that was Ctrl-C'd / killed can still
# leave an app + Xvfb behind, and those pile up into the false "welcome-dialog-
# pitch not found" wave from ~spec 14 on. Both markers here are UNIQUE to this
# harness, so this never touches other services:
#   - app/driver processes carry a per-run /tmp/keepance-l2.* path in their env
#   - only this harness runs a 1366x900x24 Xvfb (other services use 1280x1024)
# Killing Xvfb by geometry and rm-ing /tmp/keepance-l2.* by glob is safe because
# runs are SERIALIZED: this is called only AFTER ensure_driver_ports_free, and two
# run.sh invocations cannot both pass that port check. So nothing matched here is
# owned by a live harness — it is always a leftover from an already-dead prior run.
sweep_stale_l2() {
  local pid e args n=0
  for e in /proc/[0-9]*/environ; do
    grep -qaF '/tmp/keepance-l2.' "$e" 2>/dev/null || continue
    pid="${e#/proc/}"; pid="${pid%/environ}"
    [[ "$pid" == "$$" ]] && continue
    kill -KILL "$pid" 2>/dev/null && n=$((n+1)) || true
  done
  for pid in $(pgrep -x Xvfb 2>/dev/null || true); do
    args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)" || continue
    [[ "$args" == *"1366x900x24"* ]] && { kill -KILL "$pid" 2>/dev/null && n=$((n+1)) || true; }
  done
  rm -rf /tmp/keepance-l2.* 2>/dev/null || true
  [[ $n -gt 0 ]] && echo "Swept $n stale L2 process(es)/server(s) from a prior run."
  return 0
}

# Tear down everything a single spec started. The process-group kill handles the
# driver stack (tauri-driver, WebKitWebDriver, dbus-run-session, gnome-keyring,
# xvfb-run), but two things escape it and MUST be reaped explicitly, or they leak
# and break later specs in the same board:
#   1) the app binary -- WebKitWebDriver launches it in its OWN session, so the
#      process-group kill misses it. We find it by the unique per-spec temp root
#      in its environment (matches nothing outside this run).
#   2) Xvfb -- xvfb-run double-forks it and, when SIGKILLed, never runs its own
#      teardown, orphaning the X server. We kill the EXACT display this spec used
#      (recorded to $display_file), so we never touch another service's Xvfb.
cleanup_spec() {
  local driver_pid="$1" tmproot="$2" display_file="$3"
  local pid e args display

  kill -TERM -- "-$driver_pid" 2>/dev/null || true
  sleep 0.2
  kill -KILL -- "-$driver_pid" 2>/dev/null || true
  wait "$driver_pid" 2>/dev/null || true

  # (1) reap the escaped app (and any straggler) by per-spec env marker
  if [[ -n "$tmproot" ]]; then
    for e in /proc/[0-9]*/environ; do
      grep -qaF "$tmproot" "$e" 2>/dev/null || continue
      pid="${e#/proc/}"; pid="${pid%/environ}"
      [[ "$pid" == "$$" ]] && continue
      kill -KILL "$pid" 2>/dev/null || true
    done
  fi

  # (2) reap this spec's Xvfb by the exact display it picked
  if [[ -f "$display_file" ]]; then
    display="$(head -n1 "$display_file" 2>/dev/null | tr -d '[:space:]' || true)"
    display="${display%%.*}"   # ":42.0" -> ":42"
    if [[ "$display" =~ ^:[0-9]+$ ]]; then
      for pid in $(pgrep -x Xvfb 2>/dev/null || true); do
        args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)" || continue
        case " $args " in *" $display "*) kill -KILL "$pid" 2>/dev/null || true ;; esac
      done
    fi
    rm -f "$display_file" 2>/dev/null || true
  fi
}

ensure_driver_ports_free
sweep_stale_l2

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

cleanup_vite() {
  [[ -n "$VITE_PID" ]] || return 0
  kill "$VITE_PID" 2>/dev/null || true
  wait "$VITE_PID" 2>/dev/null || true
}
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

PASS=0; FAIL=0; BLOCKED=0; FAILED_NAMES=(); BLOCKED_NAMES=()

for SPEC in "${SPECS[@]}"; do
  NAME="$(basename "$SPEC")"
  TMPROOT="$(mktemp -d /tmp/keepance-l2.XXXXXX)"
  WORKSPACE="$TMPROOT/workspace"
  mkdir -p "$TMPROOT/home" "$TMPROOT/xdg-data" "$TMPROOT/xdg-config" "$TMPROOT/xdg-cache" "$WORKSPACE"
  # The driver records the Xvfb display it lands on here so cleanup can kill that
  # exact X server (and only it) afterwards.
  DISPLAY_FILE="$EVIDENCE_DIR/${NAME}.display"
  rm -f "$DISPLAY_FILE"

  # tauri-driver inherits this env (and passes it to the app it spawns), giving
  # each spec a fully isolated profile.
  DRIVER_LOG="$EVIDENCE_DIR/${NAME}.tauri-driver.log"
  # Each spec runs inside its own dbus session with an unlocked gnome-keyring,
  # so the app's OS-keychain path (vault master key, mail tokens, RAG vector key,
  # saved API keys) actually works headlessly. The fresh temp HOME means the
  # keyring is created clean per spec. Run the driver stack in its own process
  # group so cleanup kills tauri-driver, WebKitWebDriver, the app, DBus, and the
  # per-spec keyring together.
  setsid xvfb-run -a --server-args='-screen 0 1366x900x24' env \
    HOME="$TMPROOT/home" \
    XDG_DATA_HOME="$TMPROOT/xdg-data" \
    XDG_CONFIG_HOME="$TMPROOT/xdg-config" \
    XDG_CACHE_HOME="$TMPROOT/xdg-cache" \
    WEBKIT_DISABLE_COMPOSITING_MODE=1 \
    WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    GDK_BACKEND=x11 \
    TAURI_DRIVER_PORT="$TAURI_DRIVER_PORT" \
    TAURI_NATIVE_PORT="$TAURI_NATIVE_PORT" \
    WEBKIT_DRIVER="$WEBKIT_DRIVER" \
    KP_DISPLAY_FILE="$DISPLAY_FILE" \
    dbus-run-session -- bash -c '
      # Record the Xvfb display xvfb-run picked, so the parent can reap exactly
      # this X server during cleanup (xvfb-run orphans it when SIGKILLed).
      echo "${DISPLAY:-}" > "$KP_DISPLAY_FILE" 2>/dev/null || true
      printf "\n" | gnome-keyring-daemon --unlock --components=secrets >/dev/null 2>&1
      gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1 &
      # Prime the DEFAULT collection: this creates + UNLOCKS it (with the empty
      # login password) so the app does not hit "locked collection", and doubles
      # as a readiness gate for the Secret Service.
      for _ in $(seq 1 40); do
        printf "prime" | secret-tool store --label=kp-prime kpkc prime >/dev/null 2>&1 && break
        sleep 0.25
      done
      exec tauri-driver --port "$TAURI_DRIVER_PORT" --native-port "$TAURI_NATIVE_PORT" --native-driver "$WEBKIT_DRIVER"
    ' > "$DRIVER_LOG" 2>&1 &
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
    case $rc in
      0) PASS=$((PASS+1)) ;;
      2) BLOCKED=$((BLOCKED+1)); BLOCKED_NAMES+=("$NAME") ;;
      *) FAIL=$((FAIL+1)); FAILED_NAMES+=("$NAME") ;;
    esac
  fi

  cleanup_spec "$DRIVER_PID" "$TMPROOT" "$DISPLAY_FILE"
  rm -rf "$TMPROOT"
  echo
done

echo "================ L2 desktop suite ================"
echo "PASS: $PASS   FAIL: $FAIL   BLOCKED: $BLOCKED"
[[ $FAIL -gt 0 ]] && printf 'Failed:  %s\n' "${FAILED_NAMES[*]}"
[[ $BLOCKED -gt 0 ]] && printf 'Blocked: %s\n' "${BLOCKED_NAMES[*]}"
echo "Evidence: $EVIDENCE_DIR"
# Only a real FAIL fails the suite; BLOCKED is an honest "needs infra" outcome.
exit $(( FAIL > 0 ? 1 : 0 ))
