#!/usr/bin/env bash
# run-firm-backend-local.sh — start a local firm backend seeded for e2e tests.
#
# Usage:
#   ./scripts/run-firm-backend-local.sh
#
# What it does:
#   1. Starts the backend at 127.0.0.1:5290 (the Vite dev proxy default for /api/firm).
#   2. Bootstraps an org + admin + license key (the backend's BOOTSTRAP_* env mechanism).
#   3. Creates a member user and a walled-test user via POST /org/users.
#   4. Prints the env exports for tests/e2e/firm-collaboration.spec.ts and blocks.
#
# The backend writes to a temp SQLite file that is deleted on exit.
# Requirements: bun on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_DIR="${REPO_ROOT}/backend"

TMP_DB="$(mktemp /tmp/keepance-e2e-XXXXXX.sqlite)"
LOG_FILE="$(mktemp /tmp/keepance-e2e-backend-XXXXXX.log)"
echo "[run-firm-backend-local] Temp DB: ${TMP_DB}"
echo "[run-firm-backend-local] Log: ${LOG_FILE}"

export PORT=5290
export HOST=127.0.0.1
export DB_PATH="${TMP_DB}"
export LEMONSQUEEZY_WEBHOOK_SECRET=test-webhook-secret-e2e
export BOOTSTRAP_ORG_NAME="E2E Test Law LLP"
export BOOTSTRAP_ADMIN_EMAIL="admin@keepance-e2e.test"
export BOOTSTRAP_ADMIN_PASSWORD="e2e-admin-password-123"
export BOOTSTRAP_SEAT_LIMIT=5
export BOOTSTRAP_PLAN=practice

cd "${BACKEND_DIR}"
bun run src/server.ts > "${LOG_FILE}" 2>&1 &
BACKEND_PID=$!
trap 'kill ${BACKEND_PID} 2>/dev/null || true; rm -f "${TMP_DB}"; echo "[run-firm-backend-local] Cleaned up."' EXIT

echo "[run-firm-backend-local] Waiting for /healthz..."
for i in $(seq 1 30); do
  if curl -sf "http://${HOST}:${PORT}/healthz" > /dev/null 2>&1; then break; fi
  if [ "$i" -eq 30 ]; then echo "[run-firm-backend-local] ERROR: backend did not start." >&2; cat "${LOG_FILE}" >&2; exit 1; fi
  sleep 0.5
done
echo "[run-firm-backend-local] Backend healthy."

# License key: the bootstrap prints it once to the server log.
LICENSE_KEY="$(grep -o 'LICENSE KEY (shown once): .*' "${LOG_FILE}" | sed 's/.*: //' | tr -d '[:space:]')"
if [ -z "${LICENSE_KEY}" ]; then
  echo "[run-firm-backend-local] ERROR: no license key in bootstrap output." >&2
  cat "${LOG_FILE}" >&2
  exit 1
fi

# Admin access token (real endpoint: /auth/login).
ADMIN_TOKEN="$(curl -sf -X POST "http://${HOST}:${PORT}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@keepance-e2e.test","password":"e2e-admin-password-123"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
if [ -z "${ADMIN_TOKEN}" ]; then
  echo "[run-firm-backend-local] ERROR: could not obtain admin token." >&2
  exit 1
fi

# Member + walled users (real endpoint: /org/users, admin-auth).
curl -sf -X POST "http://${HOST}:${PORT}/org/users" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  -d '{"email":"member@keepance-e2e.test","password":"member-e2e-password-123","role":"member"}' > /dev/null
curl -sf -X POST "http://${HOST}:${PORT}/org/users" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" -H "Content-Type: application/json" \
  -d '{"email":"walled@keepance-e2e.test","password":"walled-e2e-password-123","role":"member"}' > /dev/null
echo "[run-firm-backend-local] Seeded member + walled users."

echo ""
echo "======================================================================"
echo "READY — export these in your test shell:"
echo "  export FIRM_E2E_BACKEND_URL=http://127.0.0.1:5290"
echo "  export FIRM_E2E_ADMIN_EMAIL=admin@keepance-e2e.test"
echo "  export FIRM_E2E_ADMIN_PASSWORD=e2e-admin-password-123"
echo "  export FIRM_E2E_MEMBER_EMAIL=member@keepance-e2e.test"
echo "  export FIRM_E2E_MEMBER_PASSWORD=member-e2e-password-123"
echo "  export FIRM_E2E_WALLED_EMAIL=walled@keepance-e2e.test"
echo "  export FIRM_E2E_WALLED_PASSWORD=walled-e2e-password-123"
echo "  export FIRM_E2E_LICENSE_KEY=${LICENSE_KEY}"
echo ""
echo "Then run:"
echo "  npx playwright test tests/e2e/firm-collaboration.spec.ts --project=en"
echo "======================================================================"
echo ""
echo "Backend PID ${BACKEND_PID} running. Press Ctrl-C to stop."
wait ${BACKEND_PID}
