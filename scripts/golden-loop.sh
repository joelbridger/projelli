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
VITE_SERVER="$HERE/golden-loop-vite-server.mjs"
DEFAULT_DIAGNOSTIC_WRITER="$HERE/write-golden-loop-diagnostic.mjs"
DIAGNOSTIC_WRITER="${GOLDEN_LOOP_DIAGNOSTIC_WRITER:-$DEFAULT_DIAGNOSTIC_WRITER}"
TIMEOUT_SECONDS="${GOLDEN_LOOP_TIMEOUT_SECONDS:-150}"
TERM_GRACE_SECONDS="${GOLDEN_LOOP_TERM_GRACE_SECONDS:-10}"
DRIVER_HEALTH_BOUND_MS="${GOLDEN_LOOP_HEALTH_BOUND_MS:-2000}"
DRIVER_READINESS_BOUND_MS="${GOLDEN_LOOP_READINESS_BOUND_MS:-8000}"
DRIVER_SNAPSHOT_BOUND_MS="${GOLDEN_LOOP_SNAPSHOT_BOUND_MS:-3000}"
DRIVER_ARTIFACT_BOUND_MS="${GOLDEN_LOOP_ARTIFACT_BOUND_MS:-2000}"
DRIVER_CLEANUP_BOUND_MS="${GOLDEN_LOOP_DRIVER_CLEANUP_BOUND_MS:-1000}"
DRIVER_DEADLINE_MARGIN_MS="${GOLDEN_LOOP_DEADLINE_MARGIN_MS:-4000}"
for bound in DRIVER_HEALTH_BOUND_MS DRIVER_READINESS_BOUND_MS DRIVER_SNAPSHOT_BOUND_MS DRIVER_ARTIFACT_BOUND_MS DRIVER_CLEANUP_BOUND_MS DRIVER_DEADLINE_MARGIN_MS; do
  [[ "${!bound}" =~ ^[1-9][0-9]*$ ]] || {
    echo 'GOLDEN LOOP FAILED: invalid driver timing contract' >&2
    exit 1
  }
done
DRIVER_STARTUP_GUARD_MS=$((
  DRIVER_HEALTH_BOUND_MS + DRIVER_READINESS_BOUND_MS + DRIVER_SNAPSHOT_BOUND_MS
  + DRIVER_ARTIFACT_BOUND_MS + DRIVER_CLEANUP_BOUND_MS + DRIVER_DEADLINE_MARGIN_MS
))
DRIVER_STARTUP_GUARD_SECONDS=$(((DRIVER_STARTUP_GUARD_MS + 999) / 1000))
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
VITE_CACHE_DIR=""
VITE_READY_FILE=""
VITE_READY_DIGEST=""
TIP_SHA=""
VITE_PID=""
APP_PID=""
XVFB_PID=""
DIAGNOSTIC_PHASE="preflight"
DIAGNOSTIC_WRITER_READY=0
ERROR_TRAP_ACTIVE=0
DRIVER_PID=""
DRIVER_PGID=""
DRIVER_GROUP_START_TIME=""

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
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

process_start_time() {
  local pid="$1" stat
  local -a stat_fields
  [ -r "/proc/$pid/stat" ] || return 1
  IFS= read -r stat <"/proc/$pid/stat" || return 1
  stat="${stat##*) }"
  read -ra stat_fields <<<"$stat"
  printf '%s\n' "${stat_fields[19]:-}"
}

driver_group_is_owned() {
  local stat rest process_group current_start
  [ -n "$DRIVER_PGID" ] && [ -n "$DRIVER_GROUP_START_TIME" ] || return 1
  [ -r "/proc/$DRIVER_PGID/stat" ] || return 1
  IFS= read -r stat <"/proc/$DRIVER_PGID/stat" || return 1
  rest="${stat##*) }"
  read -r _ _ process_group _ <<<"$rest"
  [ "$process_group" = "$DRIVER_PGID" ] || return 1
  current_start="$(process_start_time "$DRIVER_PGID" 2>/dev/null)" || return 1
  [ "$current_start" = "$DRIVER_GROUP_START_TIME" ]
}

driver_group_has_live_descendants() {
  local stat rest state process_group stat_path pid
  for stat_path in /proc/[0-9]*/stat; do
    [ -r "$stat_path" ] || continue
    IFS= read -r stat <"$stat_path" || continue
    rest="${stat##*) }"
    read -r state _ process_group _ <<<"$rest"
    pid="${stat_path#/proc/}"
    pid="${pid%/stat}"
    if [ "$pid" != "$DRIVER_PGID" ] \
      && [ "$process_group" = "$DRIVER_PGID" ] \
      && [ "$state" != "Z" ]; then
      return 0
    fi
  done
  return 1
}

stop_driver_group() {
  local descendants_remain=0 end
  [ -n "$DRIVER_PGID" ] || return 0
  if ! [[ "$DRIVER_PGID" =~ ^[1-9][0-9]*$ ]]; then
    echo "GOLDEN LOOP FAILED: refusing to signal an invalid driver process group" >&2
    return 1
  fi

  # The leader is an ownership token: it deliberately survives TERM until the
  # controller finishes the grace period and escalation. Recheck both its Linux
  # start time and process-group identity immediately before every group signal.
  if ! driver_group_is_owned; then
    echo "GOLDEN LOOP FAILED: refusing to TERM an unowned driver process group" >&2
    return 1
  fi
  if ! kill -TERM -- "-$DRIVER_PGID" 2>/dev/null; then
    echo "GOLDEN LOOP FAILED: could not TERM the owned driver process group" >&2
    return 1
  fi
  end=$((SECONDS + TERM_GRACE_SECONDS))
  while driver_group_has_live_descendants && [ "$SECONDS" -lt "$end" ]; do sleep 0.1; done
  if ! driver_group_is_owned; then
    echo "GOLDEN LOOP FAILED: refusing to KILL an unowned driver process group" >&2
    return 1
  fi
  if ! kill -KILL -- "-$DRIVER_PGID" 2>/dev/null; then
    echo "GOLDEN LOOP FAILED: could not KILL the owned driver process group" >&2
    return 1
  fi
  end=$((SECONDS + 2))
  while driver_group_has_live_descendants && [ "$SECONDS" -lt "$end" ]; do sleep 0.05; done
  if driver_group_has_live_descendants; then
    descendants_remain=1
  fi
  if [ -n "$DRIVER_PID" ]; then
    wait "$DRIVER_PID" 2>/dev/null || true
  fi
  if [ "$descendants_remain" -eq 1 ]; then
    echo "GOLDEN LOOP FAILED: owned driver process group remained live after KILL" >&2
    return 1
  fi
  DRIVER_PID="" DRIVER_PGID="" DRIVER_GROUP_START_TIME=""
}

stop_unowned_driver_leader() {
  local descendants_remain=0 end
  if ! [[ "$DRIVER_PID" =~ ^[1-9][0-9]*$ ]] || [ "$DRIVER_PGID" != "$DRIVER_PID" ]; then
    echo "GOLDEN LOOP FAILED: refusing to stop an invalid unowned driver leader" >&2
    return 1
  fi

  # This PID is still our unreaped direct child, so a positive-PID signal cannot
  # hit a recycled process. Without a start-time token, never signal its group.
  kill -TERM "$DRIVER_PID" 2>/dev/null || true
  end=$((SECONDS + 2))
  while driver_group_has_live_descendants && [ "$SECONDS" -lt "$end" ]; do sleep 0.05; done
  kill -KILL "$DRIVER_PID" 2>/dev/null || true
  end=$((SECONDS + 2))
  while driver_group_has_live_descendants && [ "$SECONDS" -lt "$end" ]; do sleep 0.05; done
  if driver_group_has_live_descendants; then
    descendants_remain=1
  fi
  wait "$DRIVER_PID" 2>/dev/null || true
  if [ "$descendants_remain" -eq 1 ]; then
    echo "GOLDEN LOOP FAILED: unowned driver descendants remained after leader cleanup" >&2
    return 1
  fi
  DRIVER_PID="" DRIVER_PGID="" DRIVER_GROUP_START_TIME=""
}

run_driver() {
  local driver_phase="${1:-}" status_file hold_file progress_file
  local deadline startup_deadline status current_start progress renderer_ready=0
  case "$driver_phase" in write|assert) ;; *) return 1 ;; esac
  status_file="$TEMP_ROOT/driver-$driver_phase.status"
  hold_file="$TEMP_ROOT/driver-$driver_phase.hold"
  progress_file="$TEMP_ROOT/driver-$driver_phase.progress"
  mkfifo "$hold_file" || return 1
  setsid bash -c '
    status_file="$1"; shift
    hold_file="$1"; shift
    driver="$1"; shift
    exec 3<>"$hold_file"
    node "$driver" "$@" &
    child=$!
    trap '\''kill -TERM "$child" 2>/dev/null || true'\'' TERM INT
    set +e
    wait "$child"
    status=$?
    temporary_status="$status_file.$$"
    printf "%s\n" "$status" >"$temporary_status" && mv "$temporary_status" "$status_file"
    while :; do read -r -t 3600 _ <&3 || true; done
  ' _ "$status_file" "$hold_file" "$DRIVER" "$@" &
  DRIVER_PID=$!
  DRIVER_PGID=$DRIVER_PID
  DRIVER_GROUP_START_TIME=""
  for _ in {1..20}; do
    if current_start="$(process_start_time "$DRIVER_PID" 2>/dev/null)"; then
      DRIVER_GROUP_START_TIME="$current_start"
      break
    fi
    sleep 0.01
  done
  if [ -z "$DRIVER_GROUP_START_TIME" ]; then
    stop_unowned_driver_leader || true
    return 1
  fi

  local driver_deadline_seconds="$TIMEOUT_SECONDS"
  if [ "$driver_deadline_seconds" -lt "$DRIVER_STARTUP_GUARD_SECONDS" ]; then
    driver_deadline_seconds="$DRIVER_STARTUP_GUARD_SECONDS"
  fi
  deadline=$((SECONDS + driver_deadline_seconds))
  startup_deadline=$((SECONDS + DRIVER_STARTUP_GUARD_SECONDS))
  while [ ! -s "$status_file" ]; do
    if ! kill -0 "$DRIVER_PID" 2>/dev/null; then
      if wait "$DRIVER_PID"; then status=0; else status=$?; fi
      if ! stop_driver_group; then return 1; fi
      return "$status"
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      if ! stop_driver_group; then return 1; fi
      return 124
    fi
    if [ -s "$progress_file.2" ]; then
      progress="$(cat "$progress_file.2" 2>/dev/null || true)"
    elif [ -s "$progress_file.1" ]; then
      progress="$(cat "$progress_file.1" 2>/dev/null || true)"
    else
      progress="$(cat "$progress_file" 2>/dev/null || true)"
    fi
    case "$progress" in
      bridge-healthy)
        [ "$renderer_ready" -eq 1 ] || DIAGNOSTIC_PHASE="renderer-dispatch"
        ;;
      renderer-ready|later-driver)
        renderer_ready=1
        DIAGNOSTIC_PHASE="later-driver"
        ;;
    esac
    if [ "$renderer_ready" -eq 0 ] && [ "$SECONDS" -ge "$startup_deadline" ]; then
      [ "$progress" = "bridge-healthy" ] || DIAGNOSTIC_PHASE="driver-startup"
      if ! stop_driver_group; then return 1; fi
      return 124
    fi
    sleep 0.05
  done
  # The child may publish readiness and exit between controller polls. Latch
  # the final fixed-grammar value before classifying its status.
  if [ -s "$progress_file.2" ]; then
    progress="$(cat "$progress_file.2" 2>/dev/null || true)"
  elif [ -s "$progress_file.1" ]; then
    progress="$(cat "$progress_file.1" 2>/dev/null || true)"
  else
    progress="$(cat "$progress_file" 2>/dev/null || true)"
  fi
  case "$progress" in
    renderer-ready|later-driver)
      renderer_ready=1
      DIAGNOSTIC_PHASE="later-driver"
      ;;
    bridge-healthy)
      [ "$renderer_ready" -eq 1 ] || DIAGNOSTIC_PHASE="renderer-dispatch"
      ;;
  esac
  status="$(<"$status_file")"
  [[ "$status" =~ ^[0-9]+$ ]] || status=1
  if ! stop_driver_group; then return 1; fi
  return "$status"
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
  if ! stop_driver_group; then status=1; fi
  stop_pid "$VITE_PID"
  if [ -n "$XVFB_PID_FILE" ] && [ -s "$XVFB_PID_FILE" ]; then
    XVFB_PID="$(cat "$XVFB_PID_FILE" 2>/dev/null || true)"
    stop_pid "$XVFB_PID"
  fi
  [ -z "$TEMP_ROOT" ] || rm -rf "$TEMP_ROOT"
  if [ "$status" -ne 0 ]; then
    trap - EXIT
    exit "$status"
  fi
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

wait_for_vite_ready() {
  local end=$((SECONDS + TIMEOUT_SECONDS)) digest
  while [ "$SECONDS" -lt "$end" ]; do
    if [ -s "$VITE_READY_FILE" ] \
      && digest="$(node "$VITE_SERVER" --verify-ready "$VITE_READY_FILE" \
        "$REPO" "$DEV_HOST" "$DEV_PORT" "$VITE_CACHE_DIR" "$VITE_PID" 2>/dev/null)" \
      && [[ "$digest" =~ ^[a-f0-9]{64}$ ]]; then
      VITE_READY_DIGEST="$digest"
      return 0
    fi
    if [ -n "$VITE_PID" ] && ! kill -0 "$VITE_PID" 2>/dev/null; then
      fail "the matching app screen server stopped before full Vite readiness"
    fi
    sleep 0.2
  done
  fail "timed out waiting for full Vite readiness"
}

reverify_vite_ready() {
  local digest
  digest="$(node "$VITE_SERVER" --verify-ready "$VITE_READY_FILE" \
    "$REPO" "$DEV_HOST" "$DEV_PORT" "$VITE_CACHE_DIR" "$VITE_PID" 2>/dev/null)" \
    || fail "the Vite readiness record changed or became stale before native launch"
  [ "$digest" = "$VITE_READY_DIGEST" ] \
    || fail "the Vite readiness identity changed before native launch"
  kill -0 "$VITE_PID" 2>/dev/null \
    || fail "the fully ready Vite server stopped before native launch"
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
[ -f "$VITE_SERVER" ] || fail "golden-loop Vite server is missing: $VITE_SERVER"
[ -d "$REPO/node_modules" ] || fail "dependencies are missing in $REPO"
TIP_SHA="$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" || fail "could not read the requested tip SHA"
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] \
  || fail "requested repo has tracked changes, so it is not an exact tip: $REPO"

DEV_URL="$(read_dev_url "$REPO")"
readarray -t DEV_PARTS < <(node -e '
  const devUrl = new URL(process.argv[1]);
  if (devUrl.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(devUrl.hostname) || !devUrl.port) process.exit(2);
  console.log(devUrl.hostname);
  console.log(devUrl.port);
' "$DEV_URL") || fail "desktop dev URL must be an explicit localhost HTTP port: $DEV_URL"
DEV_HOST="${DEV_PARTS[0]:-}"
DEV_PORT="${DEV_PARTS[1]:-}"
if [ -z "$DEV_HOST" ] || [ -z "$DEV_PORT" ]; then
  fail "could not parse desktop dev URL: $DEV_URL"
fi

if curl --silent --fail "$DEV_URL" >/dev/null 2>&1; then
  fail "$DEV_URL is already serving an app; stop it so this loop can own the exact screen source"
fi
DIAGNOSTIC_PHASE="vite-startup"
VITE_CACHE_DIR="$TEMP_ROOT/vite-cache"
VITE_READY_FILE="$TEMP_ROOT/vite-ready.json"
mkdir "$VITE_CACHE_DIR" || fail "could not create the isolated Vite cache"
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=300 \
  setsid node "$VITE_SERVER" "$REPO" "$DEV_HOST" "$DEV_PORT" "$VITE_CACHE_DIR" \
  >"$VITE_READY_FILE" 2>"$TEMP_ROOT/vite.log" &
VITE_PID=$!
wait_for_vite_ready

DIAGNOSTIC_PHASE="port-selection"
if ! BRIDGE_PORT="$(free_port)"; then
  fail "could not select a free bridge port"
fi
DIAGNOSTIC_PHASE="directory-creation"
if ! mkdir -p "$WORKSPACE"; then
  fail "could not create the golden-loop workspace"
fi
echo "golden loop provenance: source_sha=$TIP_SHA binary=$APP_BINARY dev_url=$DEV_URL"
reverify_vite_ready
launch_app launcher
DIAGNOSTIC_PHASE="bridge-health"
wait_for_http "the desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"

echo "golden loop: workspace=$WORKSPACE bridge=$BRIDGE_PORT document=$DOCUMENT_NAME.docx"
DIAGNOSTIC_PHASE="driver-startup"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
GOLDEN_LOOP_DEV_URL="$DEV_URL" \
GOLDEN_LOOP_HEALTH_BOUND_MS="$DRIVER_HEALTH_BOUND_MS" \
GOLDEN_LOOP_READINESS_BOUND_MS="$DRIVER_READINESS_BOUND_MS" \
GOLDEN_LOOP_SNAPSHOT_BOUND_MS="$DRIVER_SNAPSHOT_BOUND_MS" \
GOLDEN_LOOP_ARTIFACT_BOUND_MS="$DRIVER_ARTIFACT_BOUND_MS" \
GOLDEN_LOOP_DRIVER_PROGRESS_FILE="$TEMP_ROOT/driver-write.progress" \
  run_driver write "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME" \
  || fail "the golden-loop write driver failed"

stop_pid "$APP_PID"
APP_PID=""
DIAGNOSTIC_PHASE="restart"
launch_app restart
wait_for_http "the restarted desktop app bridge" "http://127.0.0.1:$BRIDGE_PORT/health"
GOLDEN_LOOP_DRIVER_TIMEOUT_MS="$((TIMEOUT_SECONDS * 1000))" \
GOLDEN_LOOP_DEV_URL="$DEV_URL" \
GOLDEN_LOOP_HEALTH_BOUND_MS="$DRIVER_HEALTH_BOUND_MS" \
GOLDEN_LOOP_READINESS_BOUND_MS="$DRIVER_READINESS_BOUND_MS" \
GOLDEN_LOOP_SNAPSHOT_BOUND_MS="$DRIVER_SNAPSHOT_BOUND_MS" \
GOLDEN_LOOP_ARTIFACT_BOUND_MS="$DRIVER_ARTIFACT_BOUND_MS" \
GOLDEN_LOOP_DRIVER_PROGRESS_FILE="$TEMP_ROOT/driver-assert.progress" \
  run_driver assert "$BRIDGE_PORT" "$WORKSPACE" "$DOCUMENT_NAME" \
  || fail "the golden-loop restart driver failed"

echo "GOLDEN LOOP PASS: real Documents create/save/restart/persistence verified."
