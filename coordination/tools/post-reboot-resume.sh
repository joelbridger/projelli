#!/usr/bin/env bash
# post-reboot-resume.sh — one-shot @reboot hook: respawns the Lantern-Plus
# coordinator after a planned server reboot (e.g. the 2026-07-03 NVMe install).
# Fires only if the marker file exists; consumes the marker so it never
# double-fires on later reboots. Installed via crontab @reboot.
MARKER=/home/jameson/lantern-plus/coordination/.resume-after-reboot
LOG=/home/jameson/lantern-plus/coordination/post-reboot-resume.log
[ -f "$MARKER" ] || exit 0
rm -f "$MARKER"
{
  echo "=== post-reboot resume fired $(date -Is) ==="
  # give the box time to settle (network, agents, tmux server)
  sleep 90
  /home/jameson/keepance-coordination/coordinator/tools/spawn-session.sh \
    --full-name cc-lantern-coordinator-4 \
    --dir /home/jameson/lantern-plus \
    --model claude-fable-5 --effort high \
    --handoff /home/jameson/lantern-plus/coordination/COORDINATOR-HANDOFF.md
  echo "=== spawn attempted, exit=$? ==="
} >> "$LOG" 2>&1
