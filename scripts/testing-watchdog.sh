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
#   1. The nightly timer is still enabled + scheduled.
#   2. The nightly actually RAN in the last ~26h (didn't silently stop).
#   3. The nightly's last run finished cleanly (systemd result + the log RESULT line).
#   4. The cloud guard (latest keepance-3.0 CI run) is green.
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

PROBLEMS=()
DETAILS=()

# ── 1. nightly timer enabled + scheduled ──────────────────────────────────────
if systemctl --user is-enabled --quiet "$NIGHTLY_TIMER" 2>/dev/null; then
  NEXT="$(systemctl --user list-timers --all 2>/dev/null | awk '/keepance-nightly-tests/{print $1" "$2" "$3" "$4}' | head -1)"
  DETAILS+=("Nightly timer: enabled. Next run: ${NEXT:-unknown}")
else
  PROBLEMS+=("The nightly test timer is NOT enabled — the nightly checks have stopped running.")
fi

# ── 2 + 3. nightly ran recently + finished cleanly ────────────────────────────
EXIT_REAL="$(systemctl --user show "$NIGHTLY_SVC" -p ExecMainExitTimestamp --value 2>/dev/null)"
RESULT="$(systemctl --user show "$NIGHTLY_SVC" -p Result --value 2>/dev/null)"
if [ -n "$EXIT_REAL" ]; then
  LAST_EPOCH="$(date -d "$EXIT_REAL" +%s 2>/dev/null || echo 0)"
  NOW_EPOCH="$(date +%s)"
  AGE_H=$(( (NOW_EPOCH - LAST_EPOCH) / 3600 ))
  DETAILS+=("Nightly last finished: $EXIT_REAL (~${AGE_H}h ago); result: ${RESULT:-unknown}")
  if [ "$AGE_H" -gt 26 ]; then
    PROBLEMS+=("The nightly tests have NOT run in ~${AGE_H} hours (they should run every 24h) — the inspector may have stopped.")
  fi
  if [ -n "$RESULT" ] && [ "$RESULT" != "success" ]; then
    PROBLEMS+=("The last nightly run did NOT finish cleanly (systemd result: ${RESULT}).")
  fi
else
  PROBLEMS+=("There is NO record of the nightly tests ever running yet — if this persists past tomorrow morning, the timer never fired.")
fi

# Belt + suspenders: parse the most recent nightly log's RESULT line.
LATEST_LOG="$(find /tmp -maxdepth 1 -name 'keepance-nightly-tests-*.log' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
if [ -n "$LATEST_LOG" ]; then
  RLINE="$(grep -E '^RESULT:' "$LATEST_LOG" 2>/dev/null | tail -1)"
  DETAILS+=("Latest nightly log: $(basename "$LATEST_LOG") -> ${RLINE:-(no RESULT line yet)}")
  if echo "$RLINE" | grep -q 'FAIL'; then
    PROBLEMS+=("The latest nightly log reports: ${RLINE}")
  fi
fi

# ── 4. cloud guard (CI) green ─────────────────────────────────────────────────
CI_CONC="$(gh run list --branch "$BRANCH" --limit 1 --json conclusion,status 2>/dev/null \
  | python3 -c "import json,sys
try:
    d=json.load(sys.stdin)
    print((d[0]['conclusion'] or d[0]['status']) if d else 'none')
except Exception:
    print('unknown')" 2>/dev/null || echo 'unknown')"
DETAILS+=("Cloud guard (latest $BRANCH CI run): ${CI_CONC}")
case "$CI_CONC" in
  success|in_progress|queued|requested|waiting|pending) : ;;   # green or still running = fine
  none|unknown) PROBLEMS+=("Could not read the cloud guard (CI) status — check the gh CLI / its auth.") ;;
  *) PROBLEMS+=("The cloud guard (CI) is not green — latest run conclusion: ${CI_CONC}.") ;;
esac

# ── bench status (informational; the bench script already escalates) ──────────
BSTATUS="$HOME/.local/share/keepance-bench/status.json"
if [ -f "$BSTATUS" ]; then
  BLINE="$(python3 -c "import json
try:
    d=json.load(open('$BSTATUS'))
    print('Windows='+str(d.get('windows',{}).get('last_result'))+' Mac='+str(d.get('mac',{}).get('last_result')))
except Exception:
    print('unreadable')" 2>/dev/null)"
  DETAILS+=("Real-OS benches: ${BLINE}")
fi

# ── report ────────────────────────────────────────────────────────────────────
DETAIL_TEXT="$(printf '  - %s\n' "${DETAILS[@]}")"

if [ "${#PROBLEMS[@]}" -eq 0 ]; then
  SUBJECT="[Keepance] Testing watchdog: ✅ healthy"
  BODY="Project: Keepance testing safety net (daily watchdog)
Task: Daily health check of the automatic testing system itself
Result: All good — the nightly ran and passed, the cloud guard is green, the timer is scheduled.
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
