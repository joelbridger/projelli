# LANTERN-PLUS LANES — live ownership ledger (coordinator-maintained)

**Purpose:** the O(1) answer to "what is every Lantern-Plus lane doing right now?" Updated on every spawn/merge/close (mirror of main line's `~/keepance-coordination/LANES.md` convention; the fleet dashboard reads both).

Last updated: 2026-07-04 ~01:05 (coordinator-6 seated — sole coordinator; monitors re-armed, baseline sweep clean, both lanes WORKING)

## Active lanes
| Worker session | What | State |
|---|---|---|
| cc-lantern-w3 | Wave-3 meeting capture (lp/meeting-capture @e487a730) — MERGE-READY: device verification PASSED; coordinator independent review done, 1 P2 (audit action string) confirmed+fixed+verified. Waits only for symfix to land first (re-point check on rebase) | merge-queued |
| cc-lantern-azcdp | Azure bench CDP fix (lp/azure-cdp-fix @96a56628, pushed) — DONE: root cause was an app bug (wry silently overrides WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS); fixed via .additional_browser_args() (no-op when unset); harness check PASSED live on the cloud VM; snapshot clean-3; VM deallocated (33 min). Rust-touching ⇒ merges after w3 | merge-queued |
| cc-lantern-winvm | Local Windows VM spike Phase 1 (testing-speed program #6) — KVM VM on /mnt/devcache, SSH + clean snapshot; infra only, no product code | building |
| cc-lantern-e2emirror | Linux Playwright mirror of the smoke checklist (program #7, lp/e2e-smoke-mirror) — catch UI regressions in minutes without a Windows box | building |

## Merged this session
✅ lp/symlink-hardening — pathguard module + 5 containment sites hardened (6 worker codex rounds all-real-findings + coordinator manual xhigh + independent codex CLEAN; gate 1187+51 cargo, 5670 vitest, tsc)
✅ harness-v3 @07197316 — sharded multi-target smoke + failure forensics + auto-smoke dry-run (Codex-built, coordinator-reviewed; 122 harness tests)
✅ harness-typing-fix @689f1556 — type-stdin over SSH + readback verification (kills silent typing truncation; Codex-built, coordinator-reviewed)
✅ lp/retention @3d557f20 — Wave-4 Track D (16+1 review rounds; full-branch codex caught a P1 symlink isolation breach, fixed; gate 5670 vitest + 1173 cargo)
✅ lp/harness-round2 @05feb125 — nav helpers + Wave-4 B/C checks (live shakedown pending Legion)
✅ lp/diarization @b302312c — Wave-4 Track A: diarize sidecar + encrypted voiceprints + naming UI (6 self-review rounds + coordinator xhigh + codex; gate 5634 vitest + 1133 cargo)
✅ lp/clientmap-errors @2cfe2224 — Client Map error classification (index vs provider vs unknown; 24 tests; gate 5632 vitest)
✅ lp/bench-smoke-harness — scripted bench smoke (17 checks, live-validated 6/8 on the Legion, safe-by-default; gate 5608 vitest, codex finding fixed w/ red-green proof)
✅ lp/azure-bench-fix @44b2faf8 — cloud VM now compiles+launches the full app (MSVC root-caused: cmd.exe %ERRORLEVEL% parse bug + corrupt VS Installer); fresh snapshot -clean-2; VM deallocated; CDP follow-up queued
✅ fix/vs-jump-page @5207beac (MAIN repo) — false HIPAA claim + stale facts fixed on live comparison + press-kit pages; Jameson-approved; DEPLOYED + live-verified
✅ lp/crm-wire-fixes @b3bca9a0 — Wealthbox due-date validation + write-direction fix + readback verification (gate 5608 vitest + 1108 cargo)
✅ lp/jump-strategy @e0655318 — Jump battle plan (8 sections + sources; published to claudereports)
✅ bench-prep lane DONE @617d60ea — Legion pre-warmed to current tip, health-verified, quiet (BENCH-READY.md)

## Legion sequence (one driver at a time)
✅ bench-prep → ✅ harness live-validation → 🔒 w3 Task 6 device verification (OWNS Legion now) → harness2 live validation → full Wave-3/4 scripted bench pass

## Serialization invariants
One merge in flight · one cargo per lane cache (per-lane CARGO_TARGET_DIRs on /mnt/devcache) · one Legion driver · coordinator merges only.
