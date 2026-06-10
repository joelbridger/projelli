#!/usr/bin/env bash
# VG-1 LEG 3 — real-machine wedge proof: environment orchestration.
#
# The REAL Tauri debug binary, on this rig, headless:
#   Xvfb :99 1366x768 · production frontend via `vite preview` on :5173 (no
#   HMR reload storms — the campaign's F-422 session killer) · fresh XDG
#   profile with the e5-small model cache PRE-SEEDED (no network; Option B
#   gate satisfied) · fixture workspace seeded on disk (NEVER the GTK file
#   chooser — keyboard-isolated headless) · headless Secret Service
#   (gnome-keyring under dbus-run-session): the live vector store fetches its
#   master key from the OS keychain BEFORE embedding (rag/mod.rs:446), so
#   without this, indexing fails with "vectors key: …" on any headless box.
#   Memory: systemd-run scope, MemoryMax=3G (embedder plateau ~1.4G, transient
#   peak ~2.05G — native-findings.md F-416). Check `free -h` first; this box
#   is memory-tight.
#
# Rig-verified corrections baked in (2026-06-10):
#   · gnome-keyring 46 rejects `--unlock --start` ("incompatible") and its
#     collection prompter needs a display — headless bring-up is the two-step
#     `--daemonize --login` (empty password on stdin, creates/unlocks the
#     login keyring) then `--start --components=secrets`. Probe-verified.
#   · `systemd-run --user --scope` works unchanged INSIDE dbus-run-session on
#     this rig (probe-verified), so no bus-address gymnastics are needed.
#   · resolve_cache_dir() (embedder.rs:54-66) prefers an exe-adjacent model
#     bundle when it is POPULATED — and this rig has one (gitignored Option B
#     artifact at src-tauri/resources/embeddings, mirrored by tauri-build into
#     target/debug/resources/embeddings; all 5 REQUIRED_FILES resolve). The
#     `--fresh-model` run therefore stashes the TARGET-side bundle (build
#     output, never product source) or the download card could never appear;
#     `down` restores it.
#   · README.md stays OUT of the seeded workspace: it documents the planted
#     contradictions (the answer key — indexing it would contaminate the
#     proof) and would bump the indexable count past the expected 4 files
#     (extractor.rs TEXT_EXTENSIONS over the corpus = deposition .txt,
#     incident-summary .md, huge-notes.md, acme-supply-agreement.txt).
#
# OUT OF SCOPE on this rig (stays on the Windows spot check): live mail
# import (TLS-only IMAP vs the plaintext greenmail fixture, F-419) and the
# live-audit-capture micro-item (F-425 assigns it to a keychain-bearing
# desktop; if events incidentally capture here with the headless keyring up,
# bank them as bonus evidence only).
#
# The UI pass itself is attended (xdotool + screenshots per
# docs/quality/2026-06-11-wedge-proof/RUNBOOK.md); this script provides the
# helpers (`shot`, `click`, `key`, `type`) and the disk-truth `assert`.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${WEDGE_PROFILE:-/tmp/wedge-profile}"
WS="${WEDGE_WS:-/tmp/wedge-ws}"
ART="$REPO/docs/quality/2026-06-11-wedge-proof"
DISP=":99"
PORT=5173
BIN="$REPO/src-tauri/target/debug/keepance"
MODEL_SRC="$HOME/.local/share/keepance/models/e5-small"
APP_LOG="$ART/logs/app.log"
RSS_CSV="$ART/logs/rss.csv"
SAMPLER_PID="$ART/logs/rss-sampler.pid"
# Exe-adjacent model bundle (resolve_cache_dir() prefers it when populated).
BUNDLE_MODEL="$REPO/src-tauri/target/debug/resources/embeddings/models--intfloat--multilingual-e5-small"
BUNDLE_STASH="$REPO/src-tauri/target/debug/resources/embeddings/.wedge-stash-models--intfloat--multilingual-e5-small"
# Our vite preview's exact cmdline shape (node resolves the .bin shim), so
# pkill/pgrep only ever touch the instance THIS script started.
PREVIEW_PAT="$REPO/node_modules/.bin/vite preview --port $PORT"

say() { printf '\n== %s ==\n' "$*"; }

cmd_preflight() {
  say "preflight"
  free -h | sed -n '1,2p'
  local avail_gb t
  avail_gb=$(free -g | awk '/^Mem:/{print $7}')
  [ "$avail_gb" -ge 4 ] || echo "WARN: <4G available — close something before launch"
  for t in Xvfb xdotool scrot unzip python3 secret-tool dbus-run-session rsync curl; do
    command -v "$t" >/dev/null || { echo "FAIL: required tool missing: $t"; exit 1; }
  done
  curl -sf localhost:11434/api/tags | grep -q 'llama3.2' \
    || { echo "FAIL: ollama llama3.2:3b not available"; exit 1; }
  [ -d "$MODEL_SRC/models--intfloat--multilingual-e5-small" ] \
    || { echo "FAIL: e5-small cache missing at $MODEL_SRC"; exit 1; }
  if ! dpkg -s gnome-keyring >/dev/null 2>&1; then
    echo "gnome-keyring not installed. Run once:  sudo apt-get install -y gnome-keyring"
    exit 1
  fi
  if [ -x "$BIN" ]; then
    echo "debug binary present: $BIN"
  else
    echo "NOTE: debug binary not built yet — 'up' will build it"
  fi
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "NOTE: port $PORT is currently in use — 'up' needs it free (or held by our own preview):"
    ss -ltnp "sport = :$PORT" 2>/dev/null || true
  fi
  echo "preflight OK"
}

cmd_up() {
  say "build binary (debug) + production frontend"
  echo "(if another session holds the cargo lock, cargo waits — do not kill it)"
  (cd "$REPO/src-tauri" && cargo build 2>&1 | tail -2)
  (cd "$REPO" && npm run build 2>&1 | tail -3)

  say "Xvfb $DISP"
  # ^-anchored: must never match a shell whose cmdline merely MENTIONS the
  # pattern (e.g. a tool wrapper quoting this very command).
  pkill -f "^Xvfb $DISP" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -f "^Xvfb $DISP" >/dev/null || break
    sleep 1
  done
  mkdir -p "$ART/logs" "$ART/screenshots" "$ART/output"
  Xvfb "$DISP" -screen 0 1366x768x24 >"$ART/logs/xvfb.log" 2>&1 &
  sleep 1
  DISPLAY="$DISP" xdotool getdisplaygeometry >/dev/null \
    || { echo "FAIL: Xvfb $DISP did not come up (see $ART/logs/xvfb.log)"; exit 1; }

  say "vite preview :$PORT (quiesced frontend — no HMR)"
  pkill -f "$PREVIEW_PAT" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    pgrep -f "$PREVIEW_PAT" >/dev/null || break
    sleep 1
  done
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "FAIL: port $PORT is held by a process this harness did not start:"
    ss -ltnp "sport = :$PORT" 2>/dev/null || true
    echo "Leg 3 needs $PORT (tauri.conf.json devUrl is fixed to it)."
    echo "Stop that process yourself — this script never kills foreign processes."
    exit 1
  fi
  (cd "$REPO" && nohup npx vite preview --port "$PORT" --strictPort \
      >"$ART/logs/vite-preview.log" 2>&1 &)
  for _ in $(seq 1 20); do
    curl -sf "http://localhost:$PORT" >/dev/null && break
    sleep 1
  done
  curl -sf "http://localhost:$PORT" >/dev/null \
    || { echo "FAIL: preview not up (see $ART/logs/vite-preview.log)"; exit 1; }

  say "fresh profile + model pre-seed + fixture workspace"
  rm -rf "$PROFILE" "$WS"
  mkdir -p "$PROFILE/data/keepance/models" "$PROFILE/config" "$PROFILE/cache" "$WS"
  cp -a "$MODEL_SRC" "$PROFILE/data/keepance/models/e5-small"
  rsync -a --exclude generators --exclude README.md \
    "$REPO/tests/fixtures/matter-corpus/" "$WS/"
  echo "workspace files:"; ls "$WS"
  echo "up OK — next: $0 launch   (run it in the background; it blocks)"
}

# Runs INSIDE the private dbus session (exported via `export -f`): brings up
# the headless Secret Service, proves it with a secret-tool round-trip, then
# starts the app under a 3G systemd scope with the fresh-profile XDG env.
wedge_launch_inner() {
  set -euo pipefail
  # Two-step headless keyring (gnome-keyring 46: --start and --unlock are
  # mutually exclusive, and collection creation wants a display-bound
  # prompter). --login reads an empty password from stdin and creates or
  # unlocks the login keyring; --start then raises the secrets component.
  eval "$(printf '\n' | gnome-keyring-daemon --daemonize --login)"
  eval "$(gnome-keyring-daemon --start --components=secrets)"
  export GNOME_KEYRING_CONTROL
  # Prove the Secret Service is alive BEFORE launching (otherwise the first
  # index dies with "vectors key: …", rag/mod.rs:446).
  printf 'x' | secret-tool store --label=wedge-probe service wedge key probe
  [ "$(secret-tool lookup service wedge key probe)" = "x" ] \
    || { echo "FAIL: keyring probe"; exit 1; }
  echo "keyring OK"

  ( while :; do
      pid=$(pgrep -x keepance | head -1) || true
      if [ -n "${pid:-}" ]; then
        echo "$(date +%s),$(awk '/VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null)" >>"$RSS_CSV"
      fi
      sleep 5
    done ) &
  sampler=$!
  echo "$sampler" >"$SAMPLER_PID"
  # No `exec` before systemd-run: exec would replace this shell, the EXIT
  # trap would never fire, and the sampler loop would be orphaned.
  trap 'kill "$sampler" 2>/dev/null || true; rm -f "$SAMPLER_PID"' EXIT

  systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 \
    --slice=wedgeproof \
    env DISPLAY="$DISP" GDK_BACKEND=x11 \
        XDG_DATA_HOME="$PROFILE/data" \
        XDG_CONFIG_HOME="$PROFILE/config" \
        XDG_CACHE_HOME="$PROFILE/cache" \
    "$BIN" >>"$APP_LOG" 2>&1
}

# Launch the app inside a private dbus session with an unlocked gnome-keyring
# (the standard headless-CI Secret Service pattern), under a 3G systemd scope.
# --fresh-model: REMOVE the model cache from the profile AND stash the
# exe-adjacent bundle (network stays on) to observe the Option B
# download-card → rag-banner ready handoff for real.
cmd_launch() {
  local fresh=0
  [ "${1:-}" = "--fresh-model" ] && fresh=1
  [ -x "$BIN" ] || { echo "FAIL: $BIN missing — run '$0 up' first"; exit 1; }
  free -h | sed -n '1,2p'
  if [ "$fresh" = 1 ]; then
    rm -rf "$PROFILE/data/keepance/models/e5-small"
    if [ -d "$BUNDLE_MODEL" ]; then
      mv "$BUNDLE_MODEL" "$BUNDLE_STASH"
      echo "fresh-model run: exe-adjacent model bundle stashed (restored by 'down')"
    fi
    echo "fresh-model run: model cache removed from profile (network stays on)"
  elif [ -d "$BUNDLE_STASH" ] && [ ! -d "$BUNDLE_MODEL" ]; then
    mv "$BUNDLE_STASH" "$BUNDLE_MODEL"
    echo "restored exe-adjacent model bundle from stash"
  fi
  mkdir -p "$ART/logs"
  # Rotate (never truncate) so the positive pass's evidence survives the
  # later --fresh-model run.
  if [ -s "$APP_LOG" ]; then mv "$APP_LOG" "$APP_LOG.$(date +%s)"; fi
  [ -f "$RSS_CSV" ] || echo "ts,rss_kb" >"$RSS_CSV"
  echo "# launch $(date -Is) fresh=$fresh" >>"$RSS_CSV"

  export REPO PROFILE WS ART DISP PORT BIN APP_LOG RSS_CSV SAMPLER_PID
  export -f wedge_launch_inner
  dbus-run-session -- bash -c wedge_launch_inner
}

cmd_shot()  { mkdir -p "$ART/screenshots"; DISPLAY="$DISP" scrot -z -o "$ART/screenshots/$1.png"; echo "$ART/screenshots/$1.png"; }
cmd_click() { DISPLAY="$DISP" xdotool mousemove "$1" "$2" click 1; }
cmd_key()   { DISPLAY="$DISP" xdotool key "$@"; }
cmd_type()  { DISPLAY="$DISP" xdotool type --delay 30 "$1"; }

cmd_down() {
  pkill -x keepance 2>/dev/null || true
  pkill -f "$PREVIEW_PAT" 2>/dev/null || true
  pkill -f "^Xvfb $DISP" 2>/dev/null || true
  # The launch trap kills the sampler; sweep a stale one if launch was
  # interrupted hard.
  if [ -f "$SAMPLER_PID" ]; then
    kill "$(cat "$SAMPLER_PID")" 2>/dev/null || true
    rm -f "$SAMPLER_PID"
  fi
  # gnome-keyring-daemon normally dies with its dbus session; sweep
  # stragglers. (Its comm exceeds pgrep's 15-char -x limit, so match the
  # full cmdline; nothing else on this headless box runs gnome-keyring.)
  pkill -f 'gnome-keyring-daemon.*(--login|--components=secrets)' 2>/dev/null || true
  if [ -d "$BUNDLE_STASH" ] && [ ! -d "$BUNDLE_MODEL" ]; then
    mv "$BUNDLE_STASH" "$BUNDLE_MODEL"
    echo "restored exe-adjacent model bundle from stash"
  fi
  sleep 1
  local left
  left=$(pgrep -af "target/debug/keepance|$PREVIEW_PAT|^Xvfb $DISP|gnome-keyring-daemon --" 2>/dev/null || true)
  if [ -n "$left" ]; then
    echo "WARN: still running after down:"
    echo "$left"
  fi
  echo "down OK (profile + workspace kept for inspection: $PROFILE, $WS)"
}

case "${1:-}" in
  preflight) cmd_preflight ;;
  up) cmd_up ;;
  launch) shift; cmd_launch "$@" ;;
  shot) cmd_shot "${2:?usage: $0 shot <name>}" ;;
  click) cmd_click "${2:?usage: $0 click <x> <y>}" "${3:?usage: $0 click <x> <y>}" ;;
  key) shift; cmd_key "$@" ;;
  type) cmd_type "${2:?usage: $0 type <text>}" ;;
  seed-localstorage) cmd_seed_localstorage ;;   # Task 6
  assert) cmd_assert ;;                          # Task 6
  down) cmd_down ;;
  *) echo "usage: $0 preflight|up|launch [--fresh-model]|shot <name>|click <x> <y>|key <keys>|type <text>|seed-localstorage|assert|down"; exit 1 ;;
esac
