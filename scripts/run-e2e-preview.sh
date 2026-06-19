#!/usr/bin/env bash
# scripts/run-e2e-preview.sh
#
# Build the app once, serve the static output via `vite preview`, and run the
# Playwright browser suite in ONE pass against the pre-built server.
#
# This removes the dev-server on-demand compilation that causes memory pressure
# and starves the v1.5-*/v1.6-* stress specs of their visibility timeouts.
#
# Usage:
#   ./scripts/run-e2e-preview.sh [project] [extra playwright args…]
#
#   project defaults to "en".
#   extra args are forwarded verbatim to `npx playwright test`, e.g.:
#     ./scripts/run-e2e-preview.sh en --reporter=line tests/e2e/v1.5-canvas-stress.spec.ts
#
# The preview server runs on :4173 and is cleaned up on exit.
#
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-en}"
shift || true  # remaining args forwarded to playwright

PREVIEW_PORT=4173
PREVIEW_URL="http://localhost:${PREVIEW_PORT}"

echo "==> Building app for E2E (config: vite.config.e2e.ts)…"
npx vite build --config vite.config.e2e.ts

echo "==> Starting preview server on :${PREVIEW_PORT}…"
npx vite preview --config vite.config.e2e.ts --port "${PREVIEW_PORT}" \
  >/tmp/keepance-e2e-preview.log 2>&1 &
PREVIEW_PID=$!

cleanup() {
  echo "==> Stopping preview server (PID ${PREVIEW_PID})…"
  kill "${PREVIEW_PID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Waiting for preview server to be ready…"
for i in $(seq 1 60); do
  if curl -sf "${PREVIEW_URL}" >/dev/null 2>&1; then
    echo "    Ready after ${i}s."
    break
  fi
  if [ "${i}" -eq 60 ]; then
    echo "ERROR: preview server did not start within 60s."
    echo "--- preview server log ---"
    cat /tmp/keepance-e2e-preview.log
    exit 1
  fi
  sleep 1
done

echo "==> Running Playwright (project=${PROJECT}) against ${PREVIEW_URL}…"
E2E_BASE_URL="${PREVIEW_URL}" npx playwright test \
  --project="${PROJECT}" \
  --reporter=line \
  "$@"
