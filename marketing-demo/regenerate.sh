#!/usr/bin/env bash
#
# marketing-demo/regenerate.sh — DEMO-ONLY
# One command to (re)render the Keepance product-demo MP4 deterministically.
# Starts the web-demo dev server if it isn't already running, drives it with
# Playwright (animated cursor + scripted scenes), encodes the MP4 with ffmpeg,
# and verifies it. Output: marketing-demo/output/keepance-demo.mp4
#
# Usage:
#   bash marketing-demo/regenerate.sh            # full film
#   PORT=5191 bash marketing-demo/regenerate.sh  # use a different dev port
#   SCENES=overlay bash marketing-demo/regenerate.sh   # subset (see record.mjs)
#
set -euo pipefail

# repo root = two levels up from this script
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-5188}"
BASE="http://localhost:${PORT}/try/"
STARTED=0
SRV_PID=""

# The onboarding portion (scene 2) is the V2 "concise" 4-screen prototype, served
# as a static no-cache site and captured in an iframe. Build + serve it here so
# `npm run demo:video` stays one self-contained command.
ONB_PORT="${ONB_PORT:-8911}"
ONB_DIR="$ROOT/docs/design/onboarding-prototype-v2-concise"
ONB_URL="http://localhost:${ONB_PORT}/"
ONB_STARTED=0
ONB_PID=""

cleanup() {
  if [ "$STARTED" = "1" ] && [ -n "$SRV_PID" ]; then
    kill "$SRV_PID" >/dev/null 2>&1 || true
  fi
  if [ "$ONB_STARTED" = "1" ] && [ -n "$ONB_PID" ]; then
    kill "$ONB_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if curl -sf "$BASE" >/dev/null 2>&1; then
  echo "[regenerate] web-demo already serving at $BASE"
else
  echo "[regenerate] starting web-demo dev server on :$PORT …"
  npx vite --config vite.config.web-demo.ts --port "$PORT" --strictPort \
    >/tmp/kpd-webdemo-${PORT}.log 2>&1 &
  SRV_PID=$!
  STARTED=1
  # wait for readiness (up to ~30s)
  for _ in $(seq 1 60); do
    if curl -sf "$BASE" >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! curl -sf "$BASE" >/dev/null 2>&1; then
    echo "[regenerate] ERROR: dev server did not come up; see /tmp/kpd-webdemo-${PORT}.log" >&2
    exit 1
  fi
fi

# --- onboarding prototype (scene 2) static server ---
if curl -sf "${ONB_URL}scene-1.html" >/dev/null 2>&1; then
  echo "[regenerate] onboarding prototype already serving at $ONB_URL"
else
  echo "[regenerate] building + serving the V2 concise onboarding prototype on :$ONB_PORT …"
  ( cd "$ONB_DIR" && python3 build_live.py >/tmp/kpd-onboard-build.log 2>&1 )
  ( cd "$ONB_DIR" && python3 serve_nocache.py "$ONB_PORT" dist \
      >/tmp/kpd-onboard-${ONB_PORT}.log 2>&1 ) &
  ONB_PID=$!
  ONB_STARTED=1
  for _ in $(seq 1 40); do
    if curl -sf "${ONB_URL}scene-1.html" >/dev/null 2>&1; then break; fi
    sleep 0.25
  done
  if ! curl -sf "${ONB_URL}scene-1.html" >/dev/null 2>&1; then
    echo "[regenerate] ERROR: onboarding server did not come up; see /tmp/kpd-onboard-${ONB_PORT}.log" >&2
    exit 1
  fi
fi

echo "[regenerate] rendering …"
BASE_URL="$BASE" ONBOARDING_URL="$ONB_URL" SCENES="${SCENES:-all}" node marketing-demo/render/record.mjs

echo "[regenerate] done -> marketing-demo/output/keepance-demo.mp4"
