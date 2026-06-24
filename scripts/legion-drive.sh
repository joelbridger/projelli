#!/usr/bin/env bash
# legion-drive.sh — drive the running Keepance desktop app on the Legion bench by
# its own data-testids, over CDP, by running desktop-drive.mjs ON the Legion
# (the SSH -L tunnel is blocked from the sandbox, so we drive locally on 9223).
#
# Usage:
#   scripts/legion-drive.sh snapshot
#   scripts/legion-drive.sh click <testid>
#   scripts/legion-drive.sh type <testid> "text" [--submit]
#   scripts/legion-drive.sh eval "<js>"
#   scripts/legion-drive.sh screenshot C:\\keepance\\shot.jpeg
#   scripts/legion-drive.sh waitfor "text" [seconds]
# Tip: to view a screenshot locally:
#   scripts/legion-drive.sh screenshot C:\\keepance\\shot.jpeg && \
#     scp james@100.127.67.22:C:/keepance/shot.jpeg /tmp/shot.jpeg
#
# For native OS dialogs (workspace folder picker, file save) use the pyautogui
# agent instead: ssh james@100.127.67.22 then curl 127.0.0.1:8765/... (LegionAgent task).
set -uo pipefail
LEGION="james@100.127.67.22"
[ "$#" -ge 1 ] || { echo "usage: legion-drive.sh <snapshot|click|type|eval|screenshot|waitfor> [args]"; exit 2; }
ssh -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=5 "$LEGION" \
  "cd C:\\keepance; [Environment]::SetEnvironmentVariable('DESKTOP_CDP_PORT','9223'); node scripts/desktop-drive.mjs $*"
