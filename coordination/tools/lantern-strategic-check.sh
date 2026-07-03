#!/usr/bin/env bash
# lantern-strategic-check.sh — 10-minute STRATEGIC parallelism trigger (Jameson, 2026-07-03).
# Replaces the old 15-min "what is unblocked?" parallel-check. The old question was tactical
# (blocked/unblocked); this one obligates the coordinator to think at the WHOLE-PROJECT level
# every 10 minutes: new lanes, testing speed, tooling, benches, prep work, strategy — anything
# that raises overall throughput, not just items already on the queue.
# Each emitted line is a coordinator obligation: actually answer it, don't ack it.
INTERVAL="${INTERVAL:-600}"
while true; do
  sleep "$INTERVAL"
  n=$(tmux ls -F '#{session_name}' 2>/dev/null | grep -c '^cc-lantern-')
  w=$(tmux ls -F '#{session_name}' 2>/dev/null | grep '^cc-lantern-' | grep -v coordinator | tr '\n' ' ')
  echo "STRATEGIC-CHECK ($n sessions: $w) — Looking at the WHOLE project, not just the queue: is there anything else that could run in parallel to increase efficiency? Any way to speed up testing further, safely? Any tooling, bench, prep, or analysis lane that would raise total throughput? Answer concretely or state why the current shape is optimal."
done
