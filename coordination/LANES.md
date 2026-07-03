# LANTERN-PLUS LANES — live ownership ledger (coordinator-maintained)

**Purpose:** the O(1) answer to "what is every Lantern-Plus lane doing right now?" Updated on every spawn/merge/close (mirror of main line's `~/keepance-coordination/LANES.md` convention; the fleet dashboard reads both).

Last updated: 2026-07-03 ~23:05 (coordinator-5 — now SOLE coordinator; main line stood down per Jameson, its open items absorbed: see COORDINATOR-HANDOFF.md in keepance-coordination + my task list)

## Active lanes
| Worker session | What | State |
|---|---|---|
| cc-lantern-harness2 | Harness round 2 (lp/harness-round2) — nav helper, flaky fix, Wave-4 B/C checks from merged code | building |
| cc-lantern-cmfix | Client Map error-classification fix (lp/clientmap-errors) — index vs provider errors surfaced distinctly (inherited ticket) | building |
| cc-lantern-w3 | Wave-3 meeting capture engine (lp/meeting-capture) — mid Task 5 crash recovery; Task 6 = Legion device verification (headset now available) | building |
| cc-lantern-w4d | Wave-4 Track D retention/deletion engine (lp/retention) — deep self-review round 8; xhigh merge review due | converging |
| cc-lantern-w4a | Wave-4 Track A diarization (lp/diarization) — all 7 build tasks done; self-review round 3 | converging |

## Merged this session
✅ lp/bench-smoke-harness — scripted bench smoke (17 checks, live-validated 6/8 on the Legion, safe-by-default; gate 5608 vitest, codex finding fixed w/ red-green proof)
✅ lp/azure-bench-fix @44b2faf8 — cloud VM now compiles+launches the full app (MSVC root-caused: cmd.exe %ERRORLEVEL% parse bug + corrupt VS Installer); fresh snapshot -clean-2; VM deallocated; CDP follow-up queued
✅ fix/vs-jump-page @5207beac (MAIN repo) — false HIPAA claim + stale facts fixed on live comparison + press-kit pages; Jameson-approved; DEPLOYED + live-verified
✅ lp/crm-wire-fixes @b3bca9a0 — Wealthbox due-date validation + write-direction fix + readback verification (gate 5608 vitest + 1108 cargo)
✅ lp/jump-strategy @e0655318 — Jump battle plan (8 sections + sources; published to claudereports)
✅ bench-prep lane DONE @617d60ea — Legion pre-warmed to current tip, health-verified, quiet (BENCH-READY.md)

## Legion sequence (one driver at a time)
✅ bench-prep DONE → ✅ harness live-validated → w3 Task 6 device verification NEXT (Legion free, headset ready)

## Serialization invariants
One merge in flight · one cargo per lane cache (per-lane CARGO_TARGET_DIRs on /mnt/devcache) · one Legion driver · coordinator merges only.
