#!/usr/bin/env bash
# testing-watchdog.sh — the guard that watches the guards.
#
# Runs DAILY (systemd --user timer, 14:00 UTC ≈ morning Mountain Time, after the
# 03:30 UTC nightly). It confirms the testing SYSTEM ITSELF is alive + green and
# sends Jameson a daily heartbeat.
#
# WHY THIS EXISTS: the nightly only texts on failure, so silence is ambiguous —
# a dead nightly and a healthy nightly both stay quiet. This watchdog makes the
# system PROVE it's alive every day. The heartbeat's ABSENCE is itself the alarm
# (a dead-man's-switch): if the watchdog or its timer dies, the daily message
# simply stops arriving, and that silence tells Jameson to investigate.
#
# Checks:
#   1. The nightly timer is enabled, ACTIVE, and has a real future next-run.
#   2. The nightly actually RAN in the last ~26h (didn't silently stop).
#   3. The nightly's last run finished cleanly — the log is fresh, contains
#      RESULT: PASS, has an OK: line for every required suite, and no FAILED: line.
#   4. The cloud guard (latest keepance-3.0 CI run) is green AND is tied to
#      the current pushed HEAD, not a stale/unrelated commit.
# Sends (via notify-jameson):
#   - all healthy -> daily "✅ healthy" heartbeat (info, email+telegram)
#   - any problem -> critical "NEED YOU" alert naming the issue
#
# Flags:
#   --test   Run all checks and PRINT the verdict to stdout; do NOT send any
#            notification. Use for validation.
set -uo pipefail

TEST_MODE=0
for arg in "$@"; do [[ "$arg" == "--test" ]] && TEST_MODE=1; done

NIGHTLY_SVC="keepance-nightly-tests.service"
NIGHTLY_TIMER="keepance-nightly-tests.timer"
BRANCH="keepance-3.0"

# Required suite labels — must each appear as "OK: <label>" in the nightly log.
# Derived from the run() calls in scripts/nightly-tests.sh (full non-dry-run).
REQUIRED_SUITES=(
  "build debug binary"
  "full Rust suite (incl. integration)"
  "Vitest (full)"
  "Backend Bun tests"
  "L1 browser E2E (preview server)"
  "L2 desktop harness"
)

PROBLEMS=()
DETAILS=()

# ── 1. Nightly timer: enabled + ACTIVE + real future next-run ─────────────────
# Fix 2: is-enabled alone doesn't prove the timer is firing.
# We require both is-enabled AND is-active, plus a parseable future next-run.
TIMER_ENABLED=0
TIMER_ACTIVE=0
if systemctl --user is-enabled --quiet "$NIGHTLY_TIMER" 2>/dev/null; then
  TIMER_ENABLED=1
fi
if systemctl --user is-active --quiet "$NIGHTLY_TIMER" 2>/dev/null; then
  TIMER_ACTIVE=1
fi

if [[ "$TIMER_ENABLED" -eq 0 ]]; then
  PROBLEMS+=("The nightly test timer is NOT enabled — it has been disabled and will never run again.")
elif [[ "$TIMER_ACTIVE" -eq 0 ]]; then
  PROBLEMS+=("The nightly test timer is enabled but NOT active — it is not currently running/scheduled.")
else
  # Timer is enabled + active; verify a real future next-run time.
  # Fix 2: read NextElapseUSecRealtime (systemd returns a human-readable timestamp
  # string despite the "USec" name — parse it with 'date -d').
  NEXT_STR="$(systemctl --user show "$NIGHTLY_TIMER" -p NextElapseUSecRealtime --value 2>/dev/null || true)"
  NEXT_EPOCH=0
  if [[ -n "$NEXT_STR" && "$NEXT_STR" != "0" ]]; then
    NEXT_EPOCH="$(date -d "$NEXT_STR" +%s 2>/dev/null || echo 0)"
  fi
  NOW_EPOCH="$(date +%s)"
  if [[ "$NEXT_EPOCH" -gt "$NOW_EPOCH" ]]; then
    NEXT_HUMAN="${NEXT_STR}"
    DETAILS+=("Nightly timer: enabled + active. Next run: ${NEXT_HUMAN}")
  else
    PROBLEMS+=("The nightly timer is active but shows no valid future next-run time (NextElapseUSecRealtime='${NEXT_STR:-empty}') — the schedule may be broken.")
    DETAILS+=("Nightly timer: enabled + active, but next-run time is unknown or in the past.")
  fi
fi

# ── 2 + 3. Nightly ran recently + log is fresh, complete, and passing ─────────
# Fix 5: ExecMainExitTimestamp can be blank before the first real run.
# If blank, fall back to the latest nightly log's mtime.
# If the .service is CURRENTLY active, treat that as "running now" (not a failure).
EXIT_REAL="$(systemctl --user show "$NIGHTLY_SVC" -p ExecMainExitTimestamp --value 2>/dev/null || true)"
RESULT_VAL="$(systemctl --user show "$NIGHTLY_SVC" -p Result --value 2>/dev/null || true)"

SVC_NOW_ACTIVE=0
if systemctl --user is-active --quiet "$NIGHTLY_SVC" 2>/dev/null; then
  SVC_NOW_ACTIVE=1
fi

LATEST_LOG="$(find /tmp -maxdepth 1 -name 'keepance-nightly-tests-*.log' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)"

LAST_EPOCH=0
LAST_SOURCE="(none)"

if [[ "$SVC_NOW_ACTIVE" -eq 1 ]]; then
  DETAILS+=("Nightly service: currently RUNNING (this is normal if it started after 03:30 UTC today).")
  # Don't try to assess freshness while it's mid-run — the log isn't final yet.
elif [[ -n "$EXIT_REAL" ]]; then
  LAST_EPOCH="$(date -d "$EXIT_REAL" +%s 2>/dev/null || echo 0)"
  LAST_SOURCE="systemd ExecMainExitTimestamp ($EXIT_REAL)"
elif [[ -n "$LATEST_LOG" ]]; then
  # Fix 5: fall back to log mtime when systemd has no exit timestamp.
  LAST_EPOCH="$(stat -c %Y "$LATEST_LOG" 2>/dev/null || echo 0)"
  LAST_SOURCE="latest log mtime (no systemd timestamp yet)"
fi

if [[ "$SVC_NOW_ACTIVE" -eq 0 ]]; then
  NOW_EPOCH="$(date +%s)"
  if [[ "$LAST_EPOCH" -gt 0 ]]; then
    AGE_H=$(( (NOW_EPOCH - LAST_EPOCH) / 3600 ))
    DETAILS+=("Nightly last finished: ${LAST_SOURCE} (~${AGE_H}h ago); systemd result: ${RESULT_VAL:-unknown}")
    if [[ "$AGE_H" -gt 26 ]]; then
      PROBLEMS+=("The nightly tests have NOT run in ~${AGE_H} hours (they should run every 24h) — the timer may have fired but the run did not start, or it's been skipped.")
    fi
    # Check systemd result (only meaningful when we have a real timestamp).
    if [[ -n "$RESULT_VAL" && "$RESULT_VAL" != "success" && -n "$EXIT_REAL" ]]; then
      PROBLEMS+=("The last nightly run did NOT finish cleanly (systemd result: ${RESULT_VAL}).")
    fi
  else
    # No timestamp from systemd AND no log found — genuinely never ran.
    PROBLEMS+=("There is NO record of the nightly tests ever running — the timer has not fired yet or the service has never completed a run.")
  fi
fi

# Fix 1: Belt + suspenders log check — freshness, RESULT: PASS, all suites OK, no FAILED.
# The OLD check only looked for absence of "FAIL" — a stale log, missing RESULT line,
# or silent suite skip would all read as healthy. Now we require ALL of:
#   (a) log mtime within the last ~26h
#   (b) line matching exactly ^RESULT: PASS
#   (c) an OK: <label> line for EVERY required suite
#   (d) no FAILED: line anywhere
if [[ -n "$LATEST_LOG" ]]; then
  LOG_MTIME="$(stat -c %Y "$LATEST_LOG" 2>/dev/null || echo 0)"
  NOW_EPOCH_2="$(date +%s)"
  LOG_AGE_H=$(( (NOW_EPOCH_2 - LOG_MTIME) / 3600 ))

  LOG_BASENAME="$(basename "$LATEST_LOG")"

  if [[ "$LOG_AGE_H" -gt 26 ]]; then
    PROBLEMS+=("The latest nightly log (${LOG_BASENAME}) is ${LOG_AGE_H}h old — no fresh run has completed in the last 26h.")
    DETAILS+=("Latest nightly log: ${LOG_BASENAME} — STALE (${LOG_AGE_H}h old)")
  else
    # Fresh log — now check its content.
    HAS_PASS=0
    if grep -qE '^RESULT: PASS' "$LATEST_LOG" 2>/dev/null; then
      HAS_PASS=1
    fi

    HAS_FAILED=0
    if grep -qE '^FAILED:' "$LATEST_LOG" 2>/dev/null; then
      HAS_FAILED=1
    fi

    RLINE="$(grep -E '^RESULT:' "$LATEST_LOG" 2>/dev/null | tail -1 || true)"

    MISSING_SUITES=()
    for suite in "${REQUIRED_SUITES[@]}"; do
      if ! grep -qF "OK: ${suite}" "$LATEST_LOG" 2>/dev/null; then
        MISSING_SUITES+=("$suite")
      fi
    done

    if [[ "$HAS_PASS" -eq 0 ]]; then
      PROBLEMS+=("Latest nightly log (${LOG_BASENAME}) does not contain 'RESULT: PASS' — result line: '${RLINE:-(none)}'.")
    fi
    if [[ "$HAS_FAILED" -eq 1 ]]; then
      FAILED_LINES="$(grep -E '^FAILED:' "$LATEST_LOG" 2>/dev/null | tr '\n' ' ' || true)"
      PROBLEMS+=("Latest nightly log (${LOG_BASENAME}) contains FAILED: lines: ${FAILED_LINES}")
    fi
    if [[ "${#MISSING_SUITES[@]}" -gt 0 ]]; then
      MISSING_LIST="$(printf '"%s" ' "${MISSING_SUITES[@]}")"
      PROBLEMS+=("Latest nightly log (${LOG_BASENAME}) is missing OK: lines for required suite(s): ${MISSING_LIST}— the run may have skipped suites.")
    fi

    if [[ "$HAS_PASS" -eq 1 && "$HAS_FAILED" -eq 0 && "${#MISSING_SUITES[@]}" -eq 0 ]]; then
      DETAILS+=("Latest nightly log: ${LOG_BASENAME} (${LOG_AGE_H}h old) — RESULT: PASS, all ${#REQUIRED_SUITES[@]} suites present, no FAILED lines.")
    else
      DETAILS+=("Latest nightly log: ${LOG_BASENAME} (${LOG_AGE_H}h old) — ${RLINE:-(no RESULT line)}. FAILED lines: ${HAS_FAILED}. Missing suites: ${#MISSING_SUITES[@]}.")
    fi
  fi
else
  # No log at all — note it (the PROBLEMS above from the timestamp check cover the alert).
  DETAILS+=("Latest nightly log: none found in /tmp.")
fi

# ── 4. Cloud guard: CI green AND tied to current pushed HEAD ──────────────────
# Fix 3: in_progress / queued alone are NOT unconditionally fine — a stuck run
#         would mask a broken CI indefinitely. Accept them only if recently started
#         AND the most recent *completed* run was green.
# Fix 4: scope to the current pushed HEAD SHA so an old green run doesn't pass.
#         Get the remote HEAD via git ls-remote; degrade gracefully if offline.
REMOTE_HEAD=""
if REMOTE_HEAD_RAW="$(git ls-remote origin "$BRANCH" 2>/dev/null | head -1)"; then
  REMOTE_HEAD="$(echo "$REMOTE_HEAD_RAW" | awk '{print $1}')"
fi

CI_JSON="$(gh run list --branch "$BRANCH" --workflow CI --limit 8 \
  --json headSha,conclusion,status,createdAt,workflowName 2>/dev/null || echo '[]')"

# Parse with python3: find HEAD-SHA run and most-recent-completed run.
# Data is passed as positional args to avoid shellcheck env-var complaints.
CI_VERDICT="$(python3 - "$CI_JSON" "$REMOTE_HEAD" <<'PYEOF'
import json, sys
from datetime import datetime, timezone

raw = sys.argv[1] if len(sys.argv) > 1 else '[]'
remote_head = sys.argv[2] if len(sys.argv) > 2 else ''
try:
    runs = json.loads(raw)
except Exception:
    runs = []

if not runs:
    print("PROBLEM: Could not read CI runs from GitHub — check gh CLI auth.")
    sys.exit(0)

if not remote_head:
    print("WARN: Could not fetch remote HEAD SHA (offline?) — falling back to latest run only.")
    r0 = runs[0] if runs else None
    if not r0:
        print("PROBLEM: No CI runs found for the branch.")
        sys.exit(0)
    conc = r0.get('conclusion') or r0.get('status') or 'unknown'
    stat = r0.get('status', '')
    if conc == 'success':
        print(f"OK: latest CI run is green (SHA unknown — offline check).")
    elif stat in ('in_progress', 'queued', 'requested', 'waiting', 'pending'):
        # Check age
        created = r0.get('createdAt','')
        try:
            dt = datetime.fromisoformat(created.replace('Z','+00:00'))
            age_min = (datetime.now(timezone.utc) - dt).total_seconds() / 60
        except Exception:
            age_min = 9999
        if age_min < 90:
            print(f"WARN: latest CI run is in-progress/queued ({age_min:.0f}m old) and no HEAD check possible — marking cautiously OK.")
        else:
            print(f"PROBLEM: latest CI run has been in {stat} for {age_min:.0f} minutes — appears stuck.")
    else:
        print(f"PROBLEM: latest CI run is not green — conclusion: {conc}.")
    sys.exit(0)

# Scope to HEAD SHA
head_runs = [r for r in runs if r.get('headSha','').startswith(remote_head[:12])]
completed_runs = [r for r in runs if r.get('status') == 'completed']

if not head_runs:
    # No CI run for the current pushed HEAD.
    latest_completed = completed_runs[0] if completed_runs else None
    if latest_completed:
        sha_short = latest_completed.get('headSha','?')[:8]
        conc = latest_completed.get('conclusion','?')
        print(f"PROBLEM: No CI run found for the current pushed HEAD ({remote_head[:8]}) — most recent completed run is for {sha_short} ({conc}). The latest code has not been validated by CI.")
    else:
        print(f"PROBLEM: No CI run found for the current pushed HEAD ({remote_head[:8]}) and no completed runs exist.")
    sys.exit(0)

# We have CI run(s) for the HEAD SHA — check the most recent one.
head_run = head_runs[0]
conc = head_run.get('conclusion') or ''
stat = head_run.get('status') or ''
sha_short = remote_head[:8]

if conc == 'success':
    print(f"OK: CI green for HEAD {sha_short}.")
elif stat in ('in_progress', 'queued', 'requested', 'waiting', 'pending'):
    created = head_run.get('createdAt','')
    try:
        dt = datetime.fromisoformat(created.replace('Z','+00:00'))
        age_min = (datetime.now(timezone.utc) - dt).total_seconds() / 60
    except Exception:
        age_min = 9999
    # Check if the most recent *completed* run (for any SHA) was green.
    prev_completed = next((r for r in completed_runs), None)
    prev_green = prev_completed and prev_completed.get('conclusion') == 'success'
    if age_min < 90 and prev_green:
        print(f"OK: CI run for HEAD {sha_short} is in-progress/queued ({age_min:.0f}m) — started recently and previous completed run was green.")
    elif age_min >= 90:
        print(f"PROBLEM: CI run for HEAD {sha_short} has been in {stat} for {age_min:.0f} minutes — appears stuck (CI normally completes in ~10 min).")
    else:
        print(f"PROBLEM: CI run for HEAD {sha_short} is in {stat} ({age_min:.0f}m old) but the most recent completed run was not green — cannot confirm cloud guard is healthy.")
elif conc:
    print(f"PROBLEM: CI for HEAD {sha_short} is not green — conclusion: {conc}.")
else:
    print(f"PROBLEM: CI for HEAD {sha_short} has unknown state (status={stat}, conclusion={conc}).")
PYEOF
)"

if echo "$CI_VERDICT" | grep -q '^OK:'; then
  DETAILS+=("Cloud guard (CI for $BRANCH HEAD): ${CI_VERDICT}")
elif echo "$CI_VERDICT" | grep -q '^WARN:'; then
  DETAILS+=("Cloud guard (CI for $BRANCH HEAD): ${CI_VERDICT}")
elif echo "$CI_VERDICT" | grep -q '^PROBLEM:'; then
  PROBLEMS+=("${CI_VERDICT#PROBLEM: }")
  DETAILS+=("Cloud guard (CI for $BRANCH HEAD): ${CI_VERDICT}")
else
  PROBLEMS+=("Cloud guard CI check returned unexpected output: ${CI_VERDICT}")
  DETAILS+=("Cloud guard (CI for $BRANCH HEAD): ${CI_VERDICT}")
fi

# ── bench status (informational; the bench script already escalates) ──────────
BSTATUS="$HOME/.local/share/keepance-bench/status.json"
if [ -f "$BSTATUS" ]; then
  BLINE="$(python3 -c "
import json
try:
    d=json.load(open('$BSTATUS'))
    print('Windows='+str(d.get('windows',{}).get('last_result'))+' Mac='+str(d.get('mac',{}).get('last_result')))
except Exception:
    print('unreadable')" 2>/dev/null || echo 'unreadable')"
  DETAILS+=("Real-OS benches: ${BLINE}")
fi

# ── report ────────────────────────────────────────────────────────────────────
DETAIL_TEXT="$(printf '  - %s\n' "${DETAILS[@]}")"

if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  SUBJECT="[Keepance] Testing watchdog: ✅ healthy"
  BODY="Project: Keepance testing safety net (daily watchdog)
Task: Daily health check of the automatic testing system itself
Result: All good — the nightly ran and passed all required suites, the cloud guard is green for the current code, the timer is active and scheduled.
${DETAIL_TEXT}
Next: nothing. This is your daily 'still alive' heartbeat — if these ever STOP arriving, the watchdog itself may be down, so go check."
  LEVEL="info"
else
  PROB_TEXT="$(printf '  - %s\n' "${PROBLEMS[@]}")"
  SUBJECT="[Keepance] NEED YOU: testing system health problem"
  BODY="Project: Keepance testing safety net (daily watchdog)
Task: Daily health check of the automatic testing system itself
Result: The watchdog found a problem with the testing SYSTEM (this is about the checker, not necessarily the app):
${PROB_TEXT}
Details:
${DETAIL_TEXT}
Next: Open a Claude session and have it investigate why the testing system isn't running/green."
  LEVEL="critical"
fi

if [ "$TEST_MODE" -eq 1 ]; then
  echo "=== testing-watchdog --test (no notification sent) ==="
  echo "VERDICT: $([ "${#PROBLEMS[@]}" -eq 0 ] && echo HEALTHY || echo PROBLEM)"
  echo "SUBJECT: $SUBJECT"
  echo "LEVEL:   $LEVEL"
  echo "$BODY"
  exit 0
fi

notify-jameson --subject "$SUBJECT" --body "$BODY" --level "$LEVEL" --channel email,telegram || true
echo "watchdog sent: $SUBJECT"
exit 0
