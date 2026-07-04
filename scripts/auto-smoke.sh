#!/usr/bin/env bash
# Dry-run by default. Set AUTO_SMOKE_ARMED=1 to actually touch the bench.
#
# Flow when armed:
#   1. SSH to the target bench and pull origin/lantern-plus.
#   2. Restart the dev app task so Windows rebuilds/reruns the app.
#   3. Run a freshness canary: bench HEAD must equal origin/lantern-plus.
#   4. Run bench-smoke locally against that target.
#   5. Append one verdict line to a local log.
set -uo pipefail

TARGET_ID="legion"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_ID="$2"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
auto-smoke.sh --target <bench-id>

Default: dry-run only. It prints what it would do and exits 0.
To actually run it, set AUTO_SMOKE_ARMED=1.

No timer, hook, or cron is installed by this script.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

TARGET_INFO="$(
  node --input-type=module -e '
    import { resolveTarget } from "./scripts/bench-smoke/targets.mjs";
    const t = resolveTarget(process.argv[1]);
    console.log([t.id, t.sshUser, t.sshHost, t.repoDir].join("\t"));
  ' "$TARGET_ID"
)"
IFS=$'\t' read -r RESOLVED_ID SSH_USER SSH_HOST REPO_DIR <<<"$TARGET_INFO"
SSH_DEST="${SSH_USER}@${SSH_HOST}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=5 -o StrictHostKeyChecking=no)
VERDICT_LOG="${AUTO_SMOKE_LOG:-docs/evidence/bench-smoke/auto-smoke.log}"

if [[ "${AUTO_SMOKE_ARMED:-0}" != "1" ]]; then
  cat <<EOF
[auto-smoke] DRY RUN. Set AUTO_SMOKE_ARMED=1 to run.
[auto-smoke] Would target: ${RESOLVED_ID} (${SSH_DEST}, repo ${REPO_DIR})
[auto-smoke] Would run over SSH: git fetch origin && git merge --ff-only origin/lantern-plus
[auto-smoke] Would restart the KeepanceDev scheduled task and wait for CDP/Vite.
[auto-smoke] Would run freshness canary: HEAD == origin/lantern-plus.
[auto-smoke] Would run: node scripts/bench-smoke.mjs --target ${RESOLVED_ID}
[auto-smoke] Would append one verdict line to: ${VERDICT_LOG}
EOF
  exit 0
fi

mkdir -p "$(dirname "$VERDICT_LOG")"

finish() {
  local rc="$1"
  local verdict="$2"
  printf '%s target=%s verdict=%s exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESOLVED_ID" "$verdict" "$rc" >>"$VERDICT_LOG"
  exit "$rc"
}

echo "[auto-smoke] target: ${RESOLVED_ID} (${SSH_DEST}, repo ${REPO_DIR})"

echo "[auto-smoke] pulling latest origin/lantern-plus on bench..."
if ! ssh "${SSH_OPTS[@]}" "$SSH_DEST" "cd '${REPO_DIR}'; git fetch origin; git merge --ff-only origin/lantern-plus"; then
  finish 1 "git-pull-failed"
fi

echo "[auto-smoke] restarting dev app task..."
if ! ssh "${SSH_OPTS[@]}" "$SSH_DEST" "Stop-Process -Name node,cargo,keepance,Keepance,msedgewebview2 -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 6; Start-ScheduledTask -TaskName KeepanceDev"; then
  finish 1 "rebuild-start-failed"
fi

echo "[auto-smoke] waiting for CDP(9223)+Vite(5173)..."
ready=0
for i in $(seq 1 40); do
  out="$(ssh "${SSH_OPTS[@]}" "$SSH_DEST" "try { (Invoke-WebRequest http://127.0.0.1:9223/json/version -UseBasicParsing -TimeoutSec 4).StatusCode } catch { Write-Output 0 }; (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count" 2>/dev/null || true)"
  cdp="$(printf '%s\n' "$out" | grep -oE '^(200|0)$' | head -1)"
  vite="$(printf '%s\n' "$out" | tail -1 | tr -dc '0-9')"
  echo "  poll $i: cdp=${cdp:-?} vite=${vite:-?}"
  if [[ "$cdp" == "200" && "${vite:-0}" -ge 1 ]] 2>/dev/null; then
    ready=1
    break
  fi
  sleep 15
done
if [[ "$ready" -ne 1 ]]; then
  finish 1 "rebuild-timeout"
fi

echo "[auto-smoke] freshness canary..."
if ! ssh "${SSH_OPTS[@]}" "$SSH_DEST" "cd '${REPO_DIR}'; \$head = git rev-parse HEAD; \$origin = git rev-parse origin/lantern-plus; if (\$head -ne \$origin) { Write-Output \"STALE head=\$head origin=\$origin\"; exit 42 }; Write-Output \"FRESH \$head\""; then
  finish 1 "freshness-failed"
fi

echo "[auto-smoke] running bench-smoke..."
node scripts/bench-smoke.mjs --target "$RESOLVED_ID"
rc=$?
case "$rc" in
  0) finish 0 "pass" ;;
  1) finish 1 "fail" ;;
  3) finish 3 "setup-blocked" ;;
  *) finish "$rc" "error" ;;
esac
