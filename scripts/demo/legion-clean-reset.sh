#!/usr/bin/env bash
# legion-clean-reset.sh — bring the Legion demo bench to a verified CLEAN SLATE.
# Wipes localStorage residue (accumulated maps/threads/stale workspaces), wipes the
# workspace vector index (.keepance), keeps ONLY the legit demo seed, then restarts.
# After this, OPEN the workspace to exercise the real auto-tag + auto-index flow.
#
# Usage:  scripts/demo/legion-clean-reset.sh
# Requires: app already running (CDP 9223). The OpenAI key is in the OS keychain and
# survives the wipe.
set -uo pipefail
LEGION="james@100.127.67.22"
WS_KEEPANCE='C:\keepance-demo-northcrest\Northcrest Wealth Partners\.keepance'

echo "==> 1/5 clear localStorage + lay fresh seed (app running)"
scp -o ConnectTimeout=10 scripts/demo/legion-reset.mjs "$LEGION:C:/keepance/legion-reset.mjs" >/dev/null
scp -o ConnectTimeout=10 scripts/demo/northcrest_matters.json "$LEGION:C:/northcrest_matters.json" >/dev/null
ssh -o ConnectTimeout=10 "$LEGION" "cd C:\\keepance; node legion-reset.mjs C:/northcrest_matters.json"

echo "==> 2/5 force-kill app (no graceful re-persist of stale state)"
ssh -o ConnectTimeout=10 "$LEGION" "Stop-Process -Name node,cargo,keepance,Keepance,msedgewebview2 -Force -EA SilentlyContinue; Start-Sleep 6"

echo "==> 3/5 delete workspace vector index (.keepance)"
ssh -o ConnectTimeout=10 "$LEGION" "if (Test-Path '$WS_KEEPANCE') { Remove-Item -LiteralPath '$WS_KEEPANCE' -Recurse -Force; 'deleted .keepance' } else { '.keepance not present' }"

echo "==> 4/5 restart KeepanceDev"
ssh -o ConnectTimeout=10 "$LEGION" "Start-ScheduledTask KeepanceDev; Start-Sleep 12"

echo "==> 5/5 wait for CDP 9223 + preview 5173"
for i in $(seq 1 20); do
  read -r c9 c5 < <(ssh -o ConnectTimeout=10 "$LEGION" "(Get-NetTCPConnection -LocalPort 9223 -State Listen -EA SilentlyContinue|Measure-Object).Count; (Get-NetTCPConnection -LocalPort 5173 -State Listen -EA SilentlyContinue|Measure-Object).Count" 2>/dev/null | tr '\n' ' ')
  echo "   poll $i: cdp=$c9 preview=$c5"
  [ "${c9:-0}" = "1" ] && [ "${c5:-0}" = "1" ] && { echo "READY (clean slate seeded; index wiped)"; exit 0; }
  sleep 4
done
echo "WARN: ports not both up after wait; check manually"; exit 1
