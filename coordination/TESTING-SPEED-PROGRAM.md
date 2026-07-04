# Testing-Speed Program — tracker (Jameson-approved 2026-07-04)

Jameson approved the full testing-speed/efficiency program: maximum safe parallelism, use resources
within reason, multiple cloud VM clones authorized, multiple local VMs if feasible. This doc is the
live tracker — the coordinator updates it as items land. (Board: LANES.md has lane state; this has
program state.)

| # | Idea | Status | Owner / trigger |
|---|------|--------|-----------------|
| 1 | Cloud VM clones + sharded bench passes (split the smoke checklist across N Azure VMs) | QUEUED | Fires when azcdp lands its fixed snapshot (clean-3). Then clone 2–3 VMs + run sharded. Harness sharding support = item 4's lane. |
| 2 | "Bench-ready" Azure snapshot (workspace bound + index built + connections live baked in) | QUEUED | After azcdp + one full setup pass on the cloud VM. Kills per-run setup time. |
| 3 | Auto-smoke on every merge (pull→rebuild→canary→smoke→report, automatic) | BUILDING (dry-run mode) | Part of the harness-v3 lane (Codex). Goes LIVE only after the finish-line bench pass — never churns the Legion before it. |
| 4 | Harness v3: shard-across-targets + failure forensics (console log + screenshot + screencast bundle on FAIL) | BUILDING | Codex worktree lane `harness-v3` (bounded, scripts-only; coordinator reviews + merges after w3). |
| 5 | Virtual audio driver on VMs (recorded WAV fixtures ⇒ capture tests without physical hardware) | QUEUED | On the Azure VM after azcdp, or local winvm Phase 2. NEVER on the Legion before the finish-line pass (driver install could confound the golden audio checks). |
| 6 | Local Windows VM on this server (KVM, snapshot-reset, $0) | BUILDING Phase 1 | cc-lantern-winvm. Phase 2 = toolchain+app+CDP. Cloning locally is trivial once Phase 1 proves out (qcow2 copy). |
| 7 | Linux Playwright mirror of the Windows smoke checklist (catch ~80% of regressions in minutes, no Windows machine) | BUILDING | cc-lantern-e2emirror, branch lp/e2e-smoke-mirror. |

## Standing constraints (safety rails)
- The finish line (symfix → w3 merges → full Wave 0-4 bench pass on the Legion) stays FIRST. No program item may touch the Legion or move the tip in ways that disturb it.
- One merge in flight; coordinator merges only. Program branches queue behind w3.
- Resource caps: local VMs ≤12G RAM each, pause if host available RAM <8G; Azure clones deallocated when idle, costs reported to Jameson.
- Every landed item gets: CHANGELOG entry, a row update here, and (for milestones) a notify-jameson.
