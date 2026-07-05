# Worker brief — Azure bench: merged-tip verify, bench-ready snapshot, and clones (program #1+#2)

**Lane:** cc-lantern-azclone · dir `~/lantern-plus` (infra lane — no product code; commits only to `coordination/azure-bench/SETUP-LOG.md`, on the `lantern-plus` branch — `git branch --show-current` first)
**Model:** Sonnet 5 · high. Jameson explicitly authorized multiple cloud VM clones (2026-07-04). NEVER touch the Legion — the finish-line pass owns it.

## Read first
`coordination/azure-bench/SETUP-LOG.md` in full (esp. the newest 2026-07-04 CDP section: interactive scheduled task `LanternDevBench`, auto-logon, SSH default shell = PowerShell, snapshot `lantern-cloud-bench-1-clean-3`). Azure account context: the VM is `lantern-cloud-bench-1` in resource group `lantern-bench`.

## Phase A — bring the original VM to the merged tip and re-verify (do this first)
1. `az vm start lantern-cloud-bench-1`; SSH in (`lpbench@100.75.247.98`).
2. Pull `C:\lantern-plus` to origin/lantern-plus tip (fc82c2a2 or later), rebuild (cached, ~3 min), relaunch via the scheduled task.
3. **Critical check:** CDP port 9223 must STILL come up. The merged tip changed HOW the main window is created (explicit build in setup() forwarding the env var). If CDP or the app itself breaks here, that's a P0 regression signal for the whole merged tip — STOP and report immediately (the Legion pass is running concurrently and I need to know).
4. Run 2-3 cheap harness checks from the server: `node scripts/bench-smoke.mjs --target azure-cloud-bench-1 --only index-health,wave4-whole-book-view,cross-cutting-light-theme` (adjust ids from --plan). Record results.

## Phase B — bake the bench-ready snapshot (program #2)
5. Verify the workspace/index/connection state on the VM matches what the checks need (they passed at 01:40 today, so the state exists). Deallocate, then snapshot the OS disk as `lantern-cloud-bench-ready-1` (this is the "skip setup" golden image).

## Phase C — clones (program #1)
6. Create TWO clone VMs from that snapshot: `lantern-cloud-bench-2` and `lantern-cloud-bench-3`, same size (D4s_v5), same guardrails (Tailscale join, public inbound closed, auto-shutdown 02:00 PT). Tailscale will need auth on each clone — use the same mechanism the original used (see setup log; if it needs an interactive auth key from Jameson, STOP and report rather than improvising).
7. Boot each clone, confirm SSH + CDP reachable, add each as a named target in `scripts/bench-smoke/targets.mjs`? NO — do not edit product scripts; instead record each clone's user/host/repo-dir in the SETUP-LOG (the shard runner takes ad hoc targets via --target-host/--target-user).
8. Optional if time and all green: a quick 2-way sharded smoke across bench-1 + bench-2 (`node scripts/bench-smoke-shard.mjs --target azure-cloud-bench-1 --target-host <bench-2-ip> --target-user lpbench`) as the first live shard validation.
9. **Deallocate ALL VMs when done.** Report total VM-minutes used and the monthly storage cost estimate for the snapshot + clone disks.

## Rules
- Budget: ≤2.5 hours total VM time across all machines; if a cold rebuild or Tailscale auth wall appears, report rather than burn time.
- Timeout-wrap long commands. Report at each phase boundary (A verified / snapshot done / clones up / sharded smoke result / all deallocated).
- If Phase A's CDP check FAILS: stop everything, deallocate, report P0 immediately.
- When done: summary + as the very last line: `WORKER-DONE: azclone`
