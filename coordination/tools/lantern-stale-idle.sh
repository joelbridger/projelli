#!/usr/bin/env bash
# lantern-stale-idle.sh — backstop watcher: pings ONCE when any cc-lantern-* worker
# pane is IDLE and unchanged for > STALE_SECS (default 300). Catches finished lanes
# the transition-watcher structurally cannot see (nonstandard done-lines, transitions
# during watcher downtime, undelivered queued text). Poll: 60s.
STALE_SECS="${STALE_SECS:-300}"
declare -A h t warned
while true; do
  for s in $(tmux ls -F '#{session_name}' 2>/dev/null | grep '^cc-lantern-' | grep -v coordinator); do
    pane=$(tmux capture-pane -t "$s" -p 2>/dev/null) || continue
    # skip actively-working panes
    if grep -qE 'esc to interrupt' <<<"$pane"; then h[$s]=""; continue; fi
    hh=$(md5sum <<<"$pane" | cut -d' ' -f1); now=$(date +%s)
    if [ "$hh" != "${h[$s]:-}" ]; then h[$s]="$hh"; t[$s]=$now; continue; fi
    if [ $((now - ${t[$s]:-$now})) -ge "$STALE_SECS" ] && [ "${warned[$s]:-}" != "$hh" ]; then
      echo "STALE-IDLE $s — idle+unchanged >$((STALE_SECS/60))min; last: $(grep -v '^[[:space:]]*$' <<<"$pane" | tail -1 | cut -c1-110)"
      warned[$s]="$hh"
    fi
  done
  sleep 60
done
