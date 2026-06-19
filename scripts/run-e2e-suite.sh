#!/usr/bin/env bash
#
# run-e2e-suite.sh — run the Playwright browser (L1) E2E suite reliably.
#
# WHY THIS EXISTS
# Running all ~254 browser tests in a SINGLE `npx playwright test` invocation
# deterministically times out a fixed ~42 tests at the TAIL of the run (the
# heavy `v1.5-*` / `v1.6-*` "stress" specs that sort last). Every failure is a
# `toBeVisible()` timeout. Those exact specs PASS in isolation or in small
# groups, and using a brand-new dev server does not change the count — so this
# is full-suite-scale interference (worker-process accumulation + memory
# pressure on this box over a long parallel run), NOT broken tests or product
# bugs. See docs/quality/e2e-suite-batching.md.
#
# THE FIX
# Split the run into several SEQUENTIAL shards. Each shard is a separate, short
# Playwright process, so memory is reclaimed between shards and no single run
# grows large enough to starve the tail. The whole suite then passes green.
#
# USAGE
#   scripts/run-e2e-suite.sh [project] [shards]
#     project  Playwright project to run (default: en)
#     shards   number of sequential shards (default: 6 → ~42 tests each)
#
# Exits non-zero if any shard fails.
set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT="${1:-en}"
SHARDS="${2:-6}"

# Make sure a dev server is up so every shard reuses the same one
# (playwright.config.ts has reuseExistingServer locally). If we start it, we
# stop it at the end; an already-running server (e.g. yours) is left untouched.
STARTED_DEV=0
if ! lsof -ti:5173 >/dev/null 2>&1; then
  echo "Starting Vite dev server on :5173 ..."
  npm run dev >/tmp/keepance-e2e-dev.log 2>&1 &
  STARTED_DEV=1
  for _ in $(seq 1 60); do
    curl -sf http://localhost:5173 >/dev/null 2>&1 && break
    sleep 2
  done
fi

fail=0
for k in $(seq 1 "$SHARDS"); do
  echo ""
  echo "===== shard ${k}/${SHARDS} (project=${PROJECT}) ====="
  if ! npx playwright test --project="$PROJECT" --shard="${k}/${SHARDS}" --reporter=line; then
    echo "shard ${k}/${SHARDS} FAILED"
    fail=1
  fi
done

if [ "$STARTED_DEV" -eq 1 ]; then
  lsof -ti:5173 2>/dev/null | xargs -r kill 2>/dev/null || true
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All ${SHARDS} shards passed (project=${PROJECT})."
else
  echo "One or more shards failed (project=${PROJECT})."
fi
exit "$fail"
