#!/usr/bin/env bash
# legion-sync-launch.sh — one command to put the current frontend on the Legion
# Windows bench and (re)launch the desktop app so it's drivable over CDP.
#
# Why this is fast: it syncs ONLY src/ (the frontend). Frontend changes don't
# touch the Rust core, so the Legion's warm cargo cache stays valid and the app
# comes up in seconds (Vite ~0.5s + cargo "Finished" ~2s) instead of a ~20-min
# cold Rust build. If you ALSO changed Rust (src-tauri/**), do a full sync (see
# the note at the bottom) and expect an incremental-to-full cargo rebuild.
#
# Prereqs (all one-time, already set on the Legion as of 2026-06-24):
#   - repo lives at C:\keepance ; dev launched by the KeepanceDev scheduled task
#     (runs C:\run-dev.bat -> `npm run tauri:dev`, logs to C:\tauri-dev.log)
#   - WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 (CDP)
#
# Usage: scripts/legion-sync-launch.sh
set -uo pipefail
LEGION="james@100.127.67.22"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=5)
SCP=(scp -o BatchMode=yes -o ConnectTimeout=20)
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/legion-src.tgz"

echo "[1/4] packing frontend (src/) ..."
tar czf "$TMP" -C "$REPO" src || { echo "FAIL: tar"; exit 1; }

echo "[2/4] copying to Legion (C:\\keepance) ..."
ok=0; for a in 1 2 3; do "${SCP[@]}" "$TMP" "$LEGION:C:/keepance/legion-src.tgz" && { ok=1; break; }; echo "  scp retry $a ..."; sleep 5; done
[ "$ok" = 1 ] || { echo "FAIL: scp"; exit 1; }
"${SSH[@]}" "$LEGION" "cd C:\\keepance; tar -xzf legion-src.tgz; Remove-Item legion-src.tgz" || { echo "FAIL: extract"; exit 1; }

echo "[3/4] restarting KeepanceDev (kill -> free ports -> start) ..."
"${SSH[@]}" "$LEGION" "Stop-Process -Name node,cargo,keepance,Keepance,msedgewebview2 -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 6; Start-ScheduledTask -TaskName KeepanceDev" || { echo "FAIL: restart"; exit 1; }

echo "[4/4] waiting for CDP(9223)+Vite(5173) ..."
for i in $(seq 1 40); do
  sleep 15
  out=$("${SSH[@]}" "$LEGION" "try { (Invoke-WebRequest http://127.0.0.1:9223/json/version -UseBasicParsing -TimeoutSec 4).StatusCode } catch { Write-Output 0 }; (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count" 2>/dev/null)
  cdp=$(printf '%s\n' "$out" | grep -oE '^(200|0)$' | head -1)
  vite=$(printf '%s\n' "$out" | tail -1 | tr -dc '0-9')
  echo "  poll $i: cdp=${cdp:-?} vite=${vite:-?}"
  if [ "$cdp" = "200" ] && [ "${vite:-0}" -ge 1 ] 2>/dev/null; then
    echo "READY. Drive it with:  scripts/legion-drive.sh snapshot"
    exit 0
  fi
done
echo "TIMEOUT. Inspect:  ssh $LEGION 'Get-Content C:\\tauri-dev.log -Tail 40'"
exit 1

# --- Full sync (only when Rust/src-tauri or deps changed) ---
# tar czf /tmp/legion-full.tgz -C "$REPO" src src-tauri package.json package-lock.json
# scp it over, extract, then expect cargo to rebuild changed crates (slower).
