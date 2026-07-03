ROLE: Wave 3 worker, batch 1 (local meeting-capture engine) for the Lantern-Plus program.

> COORDINATOR PRE-SPAWN GATES (do not spawn this lane until BOTH hold): (1) Waves 0–2 merged + gate-green on lantern-plus; (2) the Legion Windows bench reserved for Lantern-Plus via the bulletin (main line has priority until their release ships). Seed a cargo cache for this lane first (rsync minus debug/incremental, cargo-quiet, ≥80G free).

WORKDIR: ~/lp-w4 (git worktree, branch lp/meeting-capture off the current lantern-plus tip). NEVER touch ~/keepance or ~/lantern-plus directly. NOT self-merged — the coordinator merges.

READ IN ORDER: LANTERN-PLUS.md → docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md (Global Constraints — ALL 10 bind) → docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md (YOUR plan; the Meeting Artifact Contract is verbatim-binding).

SCOPE — batch 1 = Task 0 (SPIKE) then Tasks 1–6 ONLY:
- Task 0 FIRST, before ANY engine code: prove WASAPI loopback via cpal on the Legion (bench access details: ~/.claude/projects/-home-jameson/memory/reference_keepance_desktop_control.md; drive it yourself — NEVER ask Jameson to test). Report the spike verdict to the coordinator BEFORE continuing — if loopback fails, STOP and wait (architecture decision is the coordinator's).
- Then Tasks 1–6: crate deps + chunk writer, session manifest + finalize (chunks → stereo WAV), platform audio sources (cpal mic + loopback, mac sidecar shell), capture engine + start/stop/status commands, crash recovery, real-device verification harness.

NON-NEGOTIABLES (from the plan, repeated because they are absolute): NO cloud path for audio or transcripts — none, ever, not even a fallback; no meeting bot; audio artifacts follow the Meeting Artifact Contract folder layout exactly; `matter_id` naming locked; consent/audit entries via EncryptedAuditStore::append; crash-durability is a FEATURE REQUIREMENT (chunks flush to disk; a power cut mid-meeting must lose at most the last chunk).

ENVIRONMENT: export CARGO_TARGET_DIR=$HOME/.cargo-target-lp-w4 in every shell (this lane's own cache — per-lane caches; lanes compile concurrently). Wrap every cargo test in `timeout 1200 …`. One cargo at a time within your own lane.

RULES: TDD per task, per-task commits; verify plan anchors by symbol; the capture-engine and crash-recovery diffs are data-loss-critical — expect the coordinator's review of those at maximum scrutiny; self-converge via codex-review to a clean round (2 clean rounds for Tasks 4–5) before handoff. Report evidence (HEAD SHA, test counts incl. Legion device evidence for Task 6, drifts, decisions, "NOT self-merged") and print the sentinel as the very LAST line: WORKER-DONE: lp/meeting-capture ready for review
