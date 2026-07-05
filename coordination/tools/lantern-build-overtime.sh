#!/usr/bin/env bash
# lantern-build-overtime.sh — pings ONCE per PID when a cargo/rustc runs > CARGO_MAX
# (default 35min) or a test binary running from a ~/.cargo-target-lp-* deps dir runs
# > TEST_MAX (default 15min). Matches on comm= + /proc/pid/exe, never parsed args.
# Pane-watchers can't tell "waiting on a test" from "waiting on a HUNG test" — this can.
CARGO_MAX="${CARGO_MAX:-2100}"; TEST_MAX="${TEST_MAX:-900}"
declare -A pinged
while true; do
  now=$(date +%s)
  for pid in $(pgrep -x cargo; pgrep -x rustc); do
    [ -n "${pinged[$pid]:-}" ] && continue
    st=$(stat -c %Y "/proc/$pid" 2>/dev/null) || continue
    age=$((now - st))
    if [ "$age" -ge "$CARGO_MAX" ]; then
      echo "BUILD-OVERTIME pid=$pid $(ps -o comm= -p "$pid" 2>/dev/null) running $((age/60))min — investigate/kill?"
      pinged[$pid]=1
    fi
  done
  for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ -n "${pinged[$pid]:-}" ] && continue
    exe=$(readlink "/proc/$pid/exe" 2>/dev/null) || continue
    case "$exe" in
      "$HOME"/.cargo-target-lp-*/debug/deps/*|/mnt/devcache/cargo-target-lp-*/debug/deps/*)
        st=$(stat -c %Y "/proc/$pid" 2>/dev/null) || continue
        age=$((now - st))
        if [ "$age" -ge "$TEST_MAX" ]; then
          echo "TEST-OVERTIME pid=$pid $(basename "$exe") running $((age/60))min from lp target dir — likely hung"
          pinged[$pid]=1
        fi;;
    esac
  done
  sleep 120
done
