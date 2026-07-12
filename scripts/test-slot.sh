#!/usr/bin/env bash
# test-slot — a shared, box-wide semaphore: at most N test suites run at once.
#
# WHY (Jameson, 2026-07-12): many crews share one 20-core box. Left unthrottled they
# stacked ~40 vitest processes and doubled the load average — at which point every
# suite runs SLOWER, not faster. "Stagger your suites" lived in the briefs and was
# not obeyed, because a rule in a brief is not a mechanism. This is the mechanism.
#
# USAGE (crews wrap ANY test command):
#   scripts/test-slot.sh npm run test
#   scripts/test-slot.sh npx vitest run tests/crm --config tests/crm/vitest.config.ts
#   scripts/test-slot.sh npm run test:parity
#
# It waits for a free slot, runs the command with a capped worker count, and always
# releases its slot (even on failure/kill).
set -uo pipefail

SLOTS="${TEST_SLOTS:-2}"                 # max concurrent suites, box-wide
LOCKDIR="${TEST_SLOT_DIR:-/tmp/lantern-test-slots}"
export VITEST_MAX_FORKS="${VITEST_MAX_FORKS:-4}"   # workers per suite (config also caps)
mkdir -p "$LOCKDIR"

acquire() {
  local waited=0
  while true; do
    for i in $(seq 1 "$SLOTS"); do
      if mkdir "$LOCKDIR/slot-$i" 2>/dev/null; then
        echo "$$" > "$LOCKDIR/slot-$i/pid"
        SLOT="$LOCKDIR/slot-$i"
        [ "$waited" -gt 0 ] && echo "[test-slot] waited ${waited}s for a slot" >&2
        return 0
      fi
      # Reclaim a slot whose owner died (a killed crew must not hold it forever).
      local owner; owner="$(cat "$LOCKDIR/slot-$i/pid" 2>/dev/null || echo '')"
      if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$LOCKDIR/slot-$i"
      fi
    done
    sleep 5
    waited=$((waited + 5))
  done
}

release() { [ -n "${SLOT:-}" ] && rm -rf "$SLOT"; }
trap release EXIT INT TERM

acquire
echo "[test-slot] running with VITEST_MAX_FORKS=$VITEST_MAX_FORKS (max $SLOTS suites box-wide)" >&2
nice -n 10 "$@"
exit $?
