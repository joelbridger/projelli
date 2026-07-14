#!/usr/bin/env bash
# Launch one exact, prebuilt Lantern debug binary for the golden loop.
#
# Normal usage:
#   golden-loop-launch-app.sh <port> <workspace> <binary> <source-repo> <expected-sha>
#
# After building, record the binary's provenance once:
#   golden-loop-launch-app.sh --record-provenance <source-repo> <binary>
set -euo pipefail

fail() {
  echo "golden-loop launcher: $*" >&2
  exit 2
}

read_dev_url() {
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const config = JSON.parse(fs.readFileSync(path.join(process.argv[1], "src-tauri/tauri.conf.json"), "utf8"));
    const value = config?.build?.devUrl;
    if (typeof value !== "string" || value.length === 0) process.exit(2);
    process.stdout.write(value);
  ' "$1" || fail "could not read build.devUrl from $1/src-tauri/tauri.conf.json"
}

read_field() {
  local key="$1" file="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$file"
}

record_provenance() {
  local repo="${1:?usage: golden-loop-launch-app.sh --record-provenance <source-repo> <binary>}"
  local binary="${2:?usage: golden-loop-launch-app.sh --record-provenance <source-repo> <binary>}"
  local repo_root source_sha dev_url binary_sha provenance temp

  repo_root="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null)" \
    || fail "source repo is not a Git checkout: $repo"
  [ -x "$binary" ] || fail "cannot record provenance; binary is missing or not executable: $binary"
  [ -z "$(git -C "$repo_root" status --porcelain --untracked-files=no)" ] \
    || fail "cannot record provenance from a modified source tree: $repo_root"

  source_sha="$(git -C "$repo_root" rev-parse HEAD)"
  dev_url="$(read_dev_url "$repo_root")"
  binary_sha="$(sha256sum "$binary" | awk '{print $1}')"
  provenance="${binary}.golden-loop-provenance"
  temp="$(mktemp "${provenance}.tmp.XXXXXX")"
  {
    printf 'schema=1\n'
    printf 'source_sha=%s\n' "$source_sha"
    printf 'source_root=%s\n' "$repo_root"
    printf 'dev_url=%s\n' "$dev_url"
    printf 'binary_sha256=%s\n' "$binary_sha"
  } >"$temp"
  chmod 0644 "$temp"
  mv -f "$temp" "$provenance"
  echo "recorded binary provenance: path=$binary source_sha=$source_sha dev_url=$dev_url sha256=$binary_sha"
}

if [ "${1:-}" = "--record-provenance" ]; then
  shift
  record_provenance "$@"
  exit 0
fi

[ "$#" -eq 5 ] || fail "usage: golden-loop-launch-app.sh <port> <workspace> <binary> <source-repo> <expected-sha>"
PORT="$1"
WORKSPACE="$2"
BIN="$3"
REPO="$4"
EXPECTED_SHA="$5"
PROVENANCE="${BIN}.golden-loop-provenance"

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  fail "bridge port is invalid: $PORT"
fi
[ -x "$BIN" ] || fail "required debug binary is missing or not executable: $BIN"
[ -f "$PROVENANCE" ] \
  || fail "binary provenance is missing: $PROVENANCE (rebuild the requested tip, then run --record-provenance)"

REPO_ROOT="$(git -C "$REPO" rev-parse --show-toplevel 2>/dev/null)" \
  || fail "source repo is not a Git checkout: $REPO"
ACTUAL_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] \
  || fail "requested tip changed before launch: expected $EXPECTED_SHA, found $ACTUAL_SHA"
[ -z "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ] \
  || fail "source tree has tracked changes, so it is not the exact tip $EXPECTED_SHA: $REPO_ROOT"

RECORDED_SCHEMA="$(read_field schema "$PROVENANCE")"
RECORDED_SHA="$(read_field source_sha "$PROVENANCE")"
RECORDED_ROOT="$(read_field source_root "$PROVENANCE")"
RECORDED_DEV_URL="$(read_field dev_url "$PROVENANCE")"
RECORDED_BINARY_SHA="$(read_field binary_sha256 "$PROVENANCE")"
CURRENT_DEV_URL="$(read_dev_url "$REPO_ROOT")"
CURRENT_BINARY_SHA="$(sha256sum "$BIN" | awk '{print $1}')"

[ "$RECORDED_SCHEMA" = "1" ] || fail "binary provenance has an unsupported schema: ${RECORDED_SCHEMA:-missing}"
[ "$RECORDED_SHA" = "$EXPECTED_SHA" ] \
  || fail "stale debug binary: $BIN was built for ${RECORDED_SHA:-unknown}, but the requested tip is $EXPECTED_SHA"
[ "$RECORDED_ROOT" = "$REPO_ROOT" ] \
  || fail "binary provenance names a different source tree: ${RECORDED_ROOT:-unknown} (requested $REPO_ROOT)"
[ "$RECORDED_DEV_URL" = "$CURRENT_DEV_URL" ] \
  || fail "stale debug binary dev URL: recorded ${RECORDED_DEV_URL:-unknown}, source tip expects $CURRENT_DEV_URL"
[ "$RECORDED_BINARY_SHA" = "$CURRENT_BINARY_SHA" ] \
  || fail "debug binary changed after provenance was recorded: $BIN"
if [ -n "${LANTERN_EXPECTED_DEV_URL:-}" ] && [ "$RECORDED_DEV_URL" != "$LANTERN_EXPECTED_DEV_URL" ]; then
  fail "screen-server mismatch: binary expects $RECORDED_DEV_URL, runner started $LANTERN_EXPECTED_DEV_URL"
fi

mkdir -p "$WORKSPACE"

# A GUI app needs a display. Give this instance a private virtual display when
# the caller has none, and report its pid so the runner can clean it up.
if [ -z "${DISPLAY:-}" ]; then
  DNUM="${LANTERN_XVFB_DISPLAY_NUMBER:-$((100 + PORT % 800))}"
  VDISPLAY=":$DNUM"
  if xdpyinfo -display "$VDISPLAY" >/dev/null 2>&1; then
    if [ -z "${LANTERN_XVFB_PID_FILE:-}" ] || [ ! -s "$LANTERN_XVFB_PID_FILE" ]; then
      fail "virtual display $VDISPLAY already exists and is not owned by this run"
    fi
    EXISTING_XVFB_PID="$(cat "$LANTERN_XVFB_PID_FILE")"
    kill -0 "$EXISTING_XVFB_PID" 2>/dev/null \
      || fail "virtual display $VDISPLAY exists, but its recorded process $EXISTING_XVFB_PID is not alive"
  else
    Xvfb "$VDISPLAY" -screen 0 1600x1000x24 -nolisten tcp >/dev/null 2>&1 &
    XVFB_PID=$!
    [ -z "${LANTERN_XVFB_PID_FILE:-}" ] || printf '%s\n' "$XVFB_PID" >"$LANTERN_XVFB_PID_FILE"
    deadline=$((SECONDS + 10))
    until xdpyinfo -display "$VDISPLAY" >/dev/null 2>&1; do
      if ! kill -0 "$XVFB_PID" 2>/dev/null || [ "$SECONDS" -ge "$deadline" ]; then
        fail "virtual display did not become ready on $VDISPLAY"
      fi
      sleep 0.1
    done
  fi
  export DISPLAY="$VDISPLAY"
fi

export LANTERN_DEV_BRIDGE_PORT="$PORT"
echo "launch provenance: binary=$BIN source_sha=$RECORDED_SHA dev_url=$RECORDED_DEV_URL sha256=$RECORDED_BINARY_SHA"
echo "launching display=$DISPLAY bridge=$PORT workspace=$WORKSPACE"
setsid nohup "$BIN" --workspace "$WORKSPACE" >"$WORKSPACE/app.log" 2>&1 &
APP_PID=$!
if [ -n "${LANTERN_APP_PID_FILE:-}" ]; then
  printf '%s\n' "$APP_PID" >"$LANTERN_APP_PID_FILE"
fi
