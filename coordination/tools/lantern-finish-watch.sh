#!/usr/bin/env bash
# lantern-finish-watch.sh — fleet watcher for cc-lantern-* worker sessions.
# Emits one line per actionable transition (the coordinator's Monitor turns each
# line into a notification):
#   DONE <session> — fresh "WORKER-DONE:" in last 45 pane lines after WORKING→IDLE
#   ACK_IDLE <session> — WORKING→IDLE without the sentinel (worker finished its turn / may need input)
#   STALL <session> — WORKING but pane frozen > STALL_SECS (default 240)
# Polls every 30s. States are per-session, kept in bash assoc arrays.
STALL_SECS="${STALL_SECS:-240}"
declare -A state hash hash_since acked
while true; do
  for s in $(tmux ls -F '#{session_name}' 2>/dev/null | grep '^cc-lantern-' | grep -v coordinator); do
    pane=$(tmux capture-pane -t "$s" -p 2>/dev/null) || continue
    if grep -q 'esc to interrupt' <<<"$pane"; then cur=WORKING; else cur=IDLE; fi
    h=$(md5sum <<<"$pane" | cut -d' ' -f1)
    now=$(date +%s)
    prev="${state[$s]:-IDLE}"
    # stall detection: WORKING + frozen pane
    if [ "$cur" = WORKING ]; then
      if [ "$h" = "${hash[$s]:-}" ]; then
        since="${hash_since[$s]:-$now}"
        if [ $((now - since)) -ge "$STALL_SECS" ] && [ "${acked[$s]:-}" != "STALL-$h" ]; then
          echo "STALL $s — WORKING but pane frozen $((now - since))s"
          acked[$s]="STALL-$h"
        fi
      else
        hash[$s]="$h"; hash_since[$s]=$now
      fi
      # clear idle-ack on fresh work
      [ "${acked[$s]:-}" = DONE ] || [ "${acked[$s]:-}" = ACK ] && acked[$s]=""
    else
      hash[$s]="$h"; hash_since[$s]=$now
      if [ "$prev" = WORKING ]; then
        if tmux capture-pane -t "$s" -p 2>/dev/null | tail -45 | grep -vE 'LAST line|sentinel|print' | grep -qE '^\s*WORKER-DONE:'; then
          echo "DONE $s — $(tmux capture-pane -t "$s" -p | tail -45 | grep -vE 'LAST line|sentinel|print' | grep -E '^\s*WORKER-DONE:' | tail -1)"
          acked[$s]=DONE
        else
          echo "ACK_IDLE $s — went idle without sentinel; last line: $(grep -v '^\s*$' <<<"$pane" | tail -1 | cut -c1-120)"
          acked[$s]=ACK
        fi
      fi
    fi
    state[$s]="$cur"
  done
  sleep 30
done
