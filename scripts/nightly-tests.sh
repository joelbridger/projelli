#!/usr/bin/env bash
# Nightly full test gate. Runs on the server via systemd --user timer.
# Notifies Jameson (plain language) ONLY on failure.
#
# --dry-run  Safe for manual validation on the server.
#   Skips all git mutations and git fetch (only logs current branch + commit).
#   Skips the two heavy suites: L1 browser E2E and L2 desktop harness.
#   Never calls notify-jameson.
#   Still runs: cargo build --workspace, cargo test --workspace,
#               npx vitest run, cd backend && bun test.
#   The REAL nightly (no flag, run by systemd) does the full git-state guard,
#   ALL suites including E2E + desktop, and notifies on failure.

set -uo pipefail

DRY_RUN=0
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=1
  fi
done

cd "$HOME/keepance" || { echo "ERROR: could not cd to $HOME/keepance"; exit 1; }

LOG="/tmp/keepance-nightly-tests-$(date +%Y%m%d-%H%M%S).log"
# Redirect all output to both the terminal and the log file
exec > >(tee "$LOG") 2>&1

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT_SHA="$(git rev-parse HEAD)"
COMMIT_SUBJECT="$(git log -1 --pretty=%s)"

echo "=== Keepance nightly tests $(date -u) ==="
echo "Branch:  $BRANCH"
echo "Commit:  $COMMIT_SHA — $COMMIT_SUBJECT"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "(DRY-RUN: no git mutations, no E2E/desktop, no notifications)"
fi
echo ""

# ── Git-state guard ──────────────────────────────────────────────────────────
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[git-guard] DRY-RUN: skipping fetch and sync. Current branch + commit logged above."
else
  TARGET_BRANCH="keepance-3.0"

  if [[ "$BRANCH" != "$TARGET_BRANCH" ]]; then
    echo "[git-guard] ERROR: repo is on branch '$BRANCH', expected '$TARGET_BRANCH'. Refusing to test."
    notify-jameson \
      --subject "[Keepance] NEED YOU: nightly tests ran on the wrong branch" \
      --body "Project: Keepance (~/keepance)
Task: Automatic nightly test run
Result: The test script found the repo on branch '$BRANCH' instead of '$TARGET_BRANCH', so it stopped before running any tests. This is a safety check.
Next: Check what switched the branch and run the nightly script manually to confirm." \
      --level critical --channel email,telegram || true
    exit 1
  fi

  echo "[git-guard] Fetching origin/$TARGET_BRANCH ..."
  git fetch origin "$TARGET_BRANCH"

  AHEAD=$(git rev-list --count "origin/${TARGET_BRANCH}..HEAD")
  BEHIND=$(git rev-list --count "HEAD..origin/${TARGET_BRANCH}")

  # Dirty check: tracked files only — untracked files like .superpowers/ are ignored
  TRACKED_DIRTY=0
  git diff --quiet && git diff --cached --quiet || TRACKED_DIRTY=1

  echo "[git-guard] Ahead of origin: $AHEAD   Behind origin: $BEHIND   Tracked-dirty: $TRACKED_DIRTY"

  if [[ "$BEHIND" -gt 0 && "$AHEAD" -eq 0 && "$TRACKED_DIRTY" -eq 0 ]]; then
    echo "[git-guard] Strictly behind origin and tracked tree is clean — fast-forwarding."
    if ! git merge --ff-only "origin/$TARGET_BRANCH"; then
      echo "[git-guard] WARNING: fast-forward failed. Testing current tree as-is."
    fi
  elif [[ "$AHEAD" -gt 0 || "$TRACKED_DIRTY" -eq 1 ]]; then
    echo "[git-guard] WARNING: tree is ahead, diverged, or tracked-dirty. Testing current tree as-is."
    echo "[git-guard] This is not a false-green: the exact commit is logged below."
  else
    echo "[git-guard] Up to date with origin."
  fi

  COMMIT_SHA="$(git rev-parse HEAD)"
  COMMIT_SUBJECT="$(git log -1 --pretty=%s)"
fi

echo ""
echo ">>> TESTED COMMIT: $COMMIT_SHA — $COMMIT_SUBJECT <<<"
echo ""

# ── Test runner ──────────────────────────────────────────────────────────────
fail=0
run() {
  local label="$1"
  shift
  echo ""
  echo "##### $label #####"
  if "$@"; then
    echo "OK: $label"
  else
    echo "FAILED: $label"
    fail=1
  fi
}

# Build the debug desktop binary that the L2 harness needs.
run "build debug binary"                  bash -c 'cd src-tauri && cargo build --workspace'
run "full Rust suite (incl. integration)" bash -c 'cd src-tauri && cargo test --workspace'
run "Vitest (full)"                       npx vitest run
run "Backend Bun tests"                   bash -c 'cd backend && bun test'

if [[ "$DRY_RUN" -eq 0 ]]; then
  run "L1 browser E2E"    ./scripts/run-e2e-suite.sh en 6
  run "L2 desktop harness" npm run test:desktop

  # ── Real-OS bench step (Windows + macOS) ─────────────────────────────────
  # Runs cargo test on both always-on test machines via Tailscale and reports
  # per-OS results. This step is INFORMATIONAL only: bench failures are handled
  # by the bench script's own notify-jameson (with soft-fail escalation and a
  # status file). We do NOT flip the local `fail` flag here — the parent
  # runner's "nightly tests failed" alert stays reserved for the core Linux
  # suites so Jameson never gets double-notified for the same outage.
  echo ""
  echo "##### Real-OS bench tests (Windows + macOS) #####"
  bash "$HOME/keepance/scripts/nightly-bench-tests.sh" || true
  echo "##### End bench step #####"
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
echo ">>> TESTED COMMIT: $COMMIT_SHA — $COMMIT_SUBJECT <<<"
echo ""

if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: FAIL"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    notify-jameson \
      --subject "[Keepance] NEED YOU: nightly tests failed" \
      --body "Project: Keepance (~/keepance, branch keepance-3.0)
Task: Automatic nightly test run on the server
Result: One or more test suites failed. The full log is saved on the server at $LOG
Next: Open a Claude session, have it read the log, and fix the failing tests." \
      --level critical --channel email,telegram || true
  fi
  exit 1
fi

echo "RESULT: PASS"
exit 0
