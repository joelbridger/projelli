# LANTERN-PLUS LANES — live ownership ledger (coordinator-maintained)

**Purpose:** the O(1) answer to "what is every Lantern-Plus lane doing right now?" Updated on every spawn/merge/close (mirror of main line's `~/keepance-coordination/LANES.md` convention; the fleet dashboard reads both).

Last updated: 2026-07-04 ~05:45 (coordinator-6 — FEATURE-COMPLETE: final scorecard 11/0/3/5; 12 merges tonight; fleet idle except evidence wrap-up)

## Active lanes
| Worker session | What | State |
|---|---|---|
| cc-lantern-qafix2 | QA fix batch 2 (lp/qa-fix-batch2): QA-7 AI-hang UX + QA-8/9 onboarding overlaps | building |
| cc-lantern-qafix1 | QA fix batch 1 (lp/qa-fix-batch1; Opus): QA-5 new-client folders + QA-6 Ask input collapse (first-run P1s) | building |
| cc-lantern-w3b | Wave-3 Phase 3b: local transcription pipeline (lp/wave3-transcription; Tasks 7-9) | building |
| cc-lantern-w3c-DONE | Wave-3 Meetings SURFACE done+pushed (lp/wave3-meetings-ui): record pill, per-client Meetings tab, MeetingEntry (notes+transcript+seek), needs-review queue, consent dialog+ledger, dictation filing. Own codex found+fixed 3 bugs. Deviations: RecordPill in App.tsx (MainPanel not always rendered), workspaceService prop-threaded (DAG), template relocated. MERGES AFTER w3b (engine-first) | merge-queued |
| cc-lantern-w3c | Wave-3 Phases 3c+3d: meetings surface — record pill, Meetings tab, transcript viewer, notes, consent (lp/wave3-meetings-ui; Tasks 10-13) | building |
| cc-lantern-cleanup1 | Cleanup batch 1 + docs currency (lp/cleanup-batch1): 5 scoped items | building |

## Merged this session
✅ lp/crm-card-visibility — QA-1..4: persist CRM proposals across restart (P1), hub-wide pending banner + Review-now (P2), honest copy (P3), honest wave2 bench check (+ coordinator-review P2: navigate to Overview before asserting card). 86 touched tests green
✅ lp/cleanup-batch1 @020b5d5f — dead-dir + cosmetic keepance→lantern sweep; caught+fixed a CUSTOMER-FACING brand leak (docx author "Lantern AI"→"Advisor Prep Hero AI"); auto-smoke task-name; docs currency (independent review found the brand leak)
✅ lp/diarize-release-staging — sidecar+models staged in release.yml; FOUND+FIXED an onnxruntime lib collision that would corrupt piper in releases; local .deb verified; mac/win notarization still needs real CI
✅ qa1 evidence @1b45d8a0 — persona-A first-run: 12 findings incl 4 real P1s (new-client folders, Ask-input-collapse, AI-hang-no-feedback, onboarding overlaps)
✅ realcall evidence @13931b64 — REAL Teams call recorded; far-side (system) audio strong+continuous across 2 recordings; near-side quiet (test-rig mic isolation, not an app bug) — Teams recording CONFIRMED
✅ lp/rename-ref-migration @e88aa715 (fork) + keepance-3.0 (main repo) — /home/jameson/keepance→/lantern path hygiene in 7 scripts/docs; frozen names left; report filed
🏁 SCORECARD after cold-boot confirm: 12 PASS · 0 FAIL · 2 SETUP-BLOCKED · 5 stubs. ⚠️ CORRECTION (Jameson caught it): the 5 stubs = the UNBUILT Wave-3 UI (Meetings tab/record pill/transcription) — feature-complete was over-claimed; engine done, surface in build now (w3b+w3c lanes)
✅ lp/bench-harness-clients-tab-fix @02d153b5 — Clients-tab normalization + note-collision + wave1 modal-close (126+ harness tests)
✅ lp/bench-harness-followup-fixes @64df925e — overlay-dismiss prefers Close (native-dialog trap killed) + wave1 nav
✅ lp/pathguard-windows-verbatim @<post-pathfix> — CONFIRMED Windows verbatim-path bug in the absolute walk (red-on-Windows proof, green after) + 2 pre-existing Windows caller bugs (.. defense layer, live-recording orphan mismatch); pathguard 10/10 + capture 26/26 ON REAL WINDOWS; gate 1233 cargo + vitest green
✅ lp/audit-chain-failclosed @5af15e5e — fail-closed tamper evidence (seal-missing vs altered vs full-wipe via high-water mark) + acknowledged repair UI (inherited #14; Opus xhigh; 4 codex rounds + coordinator independent review; gate 1227 cargo + 5681 vitest)
✅ lp/wave4-gap-sync @85c4a633 — unresolved gap wins the Client Map initial tab (bench FAIL #2 fixed; red-first tests + first mirror-caught regression spec; 5673 vitest + 16/16 mirror)
✅ vaudio spike DONE @841f4ab0 — virtual audio VIABLE on cloud benches (VB-CABLE, tone proven at engine level); flagged a possible Windows-only capture_start pathguard bug → pathfix lane
✅ lp/bench-harness-round2-fixes @00558e1d — 3 live-root-caused harness bugs (wrapper-click, Grid-view state, snapshot false-negative); 124 harness tests
✅ azclone lane DONE @0bab65b7 — merged-tip verified on cloud VM (CDP fix live); bench-ready golden snapshot; clone bench-2 zero-rebuild; FIRST live 2-way sharded smoke PASS (~$0.20)
✅ lp/e2e-smoke-mirror @fc82c2a2 — Playwright mirror: 11/19 bench checks in ~15s on Linux (44 specs green post-merge)
✅ lp/azure-cdp-fix @395923fd — wry CDP env-var fix (root-caused real app bug; cloud bench is now a working 2nd smoke target)
✅ lp/meeting-capture — 🏁 WAVE 3, the LAST feature lane (device-verified on real hardware pre-merge; 17 worker rounds + coordinator independent review w/ 1 confirmed-fixed P2; gate 1218 cargo + bins + 5670 vitest + tsc)
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
