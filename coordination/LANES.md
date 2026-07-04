# LANTERN-PLUS LANES — live ownership ledger (coordinator-maintained)

**Purpose:** the O(1) answer to "what is every Lantern-Plus lane doing right now?" Updated on every spawn/merge/close (mirror of main line's `~/keepance-coordination/LANES.md` convention; the fleet dashboard reads both).

Last updated: 2026-07-04 ~01:05 (coordinator-6 seated — sole coordinator; monitors re-armed, baseline sweep clean, both lanes WORKING)

## Active lanes
| Worker session | What | State |
|---|---|---|
| cc-lantern-symfix | Symlink-hardening (lp/symlink-hardening) — apply no-follow walk to vault/mcp/diarize containment checks (audit findings; xhigh) | building |
| cc-lantern-w3 | Wave-3 meeting capture (lp/meeting-capture @e487a730) — MERGE-READY: device verification PASSED; coordinator independent review done, 1 P2 (audit action string) confirmed+fixed+verified. Waits only for symfix to land first (re-point check on rebase) | merge-queued |
| cc-lantern-azcdp | Azure bench CDP fix (lp/azure-cdp-fix) — make WebView2 port 9223 listen on lantern-cloud-bench-1 so the cloud VM becomes a 2nd smoke target (task #13; ≤90min VM budget) | building |
| cc-lantern-winvm | Local Windows VM spike Phase 1 (Jameson-endorsed testing-speed idea) — KVM VM on /mnt/devcache, SSH + clean snapshot; infra only, no product code | building |

## Merged this session
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
