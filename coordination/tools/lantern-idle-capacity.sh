#!/usr/bin/env bash
# lantern-idle-capacity — the parallelization monitor that names IDLE RESOURCES,
# not an open question. Fires every 10 min. Each idle resource is a concrete fact
# the coordinator must either USE or justify as genuinely blocked. "It would add
# to my merge gate" is NOT a valid reason to leave a bench/Codex/analysis slot idle.
INTERVAL="${1:-600}"   # 10 min default (Jameson 2026-07-06: ask the parallelism question every 10 minutes)
while true; do
  sleep "$INTERVAL"
  OUT="IDLE-CAPACITY CHECK — use each idle resource or state why it's genuinely blocked (NOT 'adds to my gate'):"

  # 1) Legion — is a cc-lantern-* session currently driving it? (owns-Legion lanes: bench/regression/meetverify/sidecar/trustreview/transfix)
  LEGION_DRIVER=$(tmux ls 2>/dev/null | grep -oE 'cc-lantern-(regression|meetverify[0-9]*|sidecar|trustreview|transfix|noticeverify|meetverify|legionwarm|winsmoke|legion[a-z0-9]*|smoke[a-z0-9]*)' | head -1)
  if [ -z "$LEGION_DRIVER" ]; then OUT="$OUT
  • LEGION: FREE — no session driving it. Real-Windows testing/verification available NOW."
  else OUT="$OUT
  • LEGION: in use by $LEGION_DRIVER."; fi

  # 2) Azure cloud benches — running or deallocated? (deallocated = free capacity, parallel to the Legion)
  for VM in lantern-cloud-bench-1 lantern-cloud-bench-2; do
    PS=$(az vm get-instance-view -g lantern-bench -n "$VM" --query "instanceView.statuses[?starts_with(code,'PowerState')].code | [0]" -o tsv 2>/dev/null)
    [ -z "$PS" ] && PS="unknown"
    case "$PS" in
      *running*) OUT="$OUT
  • $VM: RUNNING — should have a driver; if not, it's costing money idle.";;
      *) OUT="$OUT
  • $VM: $PS — startable for PARALLEL non-audio testing (bench-2 has VB-CABLE for audio). Cloud benches run alongside the Legion.";;
    esac
  done

  # 3) Codex — read-only analysis/review is near-free and never touches the merge gate
  CODEX_N=$(pgrep -c -f 'openai/codex' 2>/dev/null || echo 0)
  OUT="$OUT
  • CODEX: $CODEX_N job(s) running. Read-only analysis/adversarial-review/investigation is near-free (network-bound) and does NOT compete with the merge gate — fan out freely."

  # 4) Worker lanes vs steady-state
  LANES=$(tmux ls 2>/dev/null | grep -cE 'cc-lantern-[a-z0-9]+:' )
  OUT="$OUT
  • WORKER LANES: $LANES active. Steady-state sweet spot ~5-6 writers; memory is NOT the constraint. If building lanes < that AND independent work exists, open more."

  echo "$OUT
  → Answer each line. Bench/cloud/Codex/analysis idle capacity is throughput you are leaving on the table — the merge gate does not gate THEM.
  → JAMESON'S STANDING QUESTION (answer it fresh every time, don't pattern-match to your last answer): \"Is there anything else you could be doing in parallel or any other resources you could be using?\" Remember: a tip-freeze blocks MERGES, not isolated-worktree BUILDS; build-only lanes are allowed during freezes."
done
