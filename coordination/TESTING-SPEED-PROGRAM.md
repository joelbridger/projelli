# Testing-Speed Program — tracker (Jameson-approved 2026-07-04)

Jameson approved the full testing-speed/efficiency program: maximum safe parallelism, use resources
within reason, multiple cloud VM clones authorized, multiple local VMs if feasible. This doc is the
live tracker — the coordinator updates it as items land. (Board: LANES.md has lane state; this has
program state.)

| # | Idea | Status | Owner / trigger |
|---|------|--------|-----------------|
| 1 | Cloud VM clones + sharded bench passes | ✅ LIVE (2-way) | bench-1 + clone bench-2 ran the first live 2-way sharded smoke — PASS (evidence sharded-20260704-030352). bench-3 blocked by a 10-core regional quota (increase request failed — account too new; ticket a8a59e7e). Landmine logged: cloned disks carry Tailscale identity — reset on clone. |
| 2 | "Bench-ready" Azure snapshot | ✅ DONE | Snapshot lantern-cloud-bench-ready-1: merged tip built, workspace+index+connections baked. Proven: bench-2 booted from it with ZERO rebuild. Follow-ups: prune 2 pre-fix snapshots; 1 harness check returned SETUP-BLOCKED on the VM (test-navigation issue, not app). |
| 3 | Auto-smoke on every merge (pull→rebuild→canary→smoke→report, automatic) | ✅ MERGED (dry-run gated) | Script landed (auto-smoke.sh). Arm AFTER the finish-line pass; fix hard-coded task name first (P3). |
| 4 | Harness v3: shard-across-targets + failure forensics (console errors + screenshot + app-log tail on FAIL) | ✅ MERGED | Codex-built, coordinator-reviewed, 122 tests green. Sharding ready for the Azure clones. |
| 5 | Virtual audio driver on VMs | ✅ VIABLE | VB-CABLE silent-installs (<1 min, attestation-signed, needs az run-command for elevation — SSH is not UAC-elevated); real 440Hz tone captured via cpal/WASAPI (RMS 0.40). Limit: single cable = no channel-isolation testing (stays on the Legion). Write-up: coordination/azure-bench/VIRTUAL-AUDIO-SPIKE.md. Side-effects: bench-2 app unresponsive post-install (reset from snapshot before next use); a possible Windows-only capture_start pathguard bug flagged → own fix lane. |
| 6 | Local Windows VM on this server (KVM, snapshot-reset, $0) | ⛔ BLOCKED w/ findings | Installer never progressed past WinPE across 2 attempts (~50 min, CPU active, no disk writes). Boot-race solved (reusable). Full diagnostics: coordination/winvm/SETUP-LOG.md @7ce0c0d8. VM left running unattended; kill if not installed by morning. Azure sharding covers the capacity need. |
| 7 | Linux Playwright mirror of the Windows smoke checklist | ✅ MERGED | 11/19 checks in ~15s on Linux (44 specs green post-merge); 8 honestly NOT-MIRRORABLE (Tauri-only). docs/qa/E2E-SMOKE-MIRROR.md. |

## Standing constraints (safety rails)
- The finish line (symfix → w3 merges → full Wave 0-4 bench pass on the Legion) stays FIRST. No program item may touch the Legion or move the tip in ways that disturb it.
- One merge in flight; coordinator merges only. Program branches queue behind w3.
- Resource caps: local VMs ≤12G RAM each, pause if host available RAM <8G; Azure clones deallocated when idle, costs reported to Jameson.
- Every landed item gets: CHANGELOG entry, a row update here, and (for milestones) a notify-jameson.
