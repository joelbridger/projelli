# Fix brief — RACE-P0: stale-async cross-client/data leaks (QA-52..59, incl 3 P0 isolation breaches)

**Lane:** cc-lantern-racep0 · dir `~/lp-racep0` (own worktree, branch `lp/race-p0`). **Model:** Opus 4.8 · high (cross-client/biometric isolation — the product's CORE promise; correctness-critical).
**Read FIRST:** BUG-DB QA-52..59 + coordination/qa-campaign/static-race-sweep.md (findings with file:line). **Rules:** NO-SHORTCUTS. TDD red-first. Codex self-review foreground/watched, ≥2 clean-adjacent rounds (isolation bar). PULL + reconcile before handoff. 🔒 DONE MEANS PUSHED.

## The class (all the same shape)
An async op (workspace load, email file/draft, voiceprint list, citation verify, memory-facts list) completes AFTER the user switched client/workspace/email/citation, and its late callback writes state for the OLD target onto the NEW one → cross-client data bleed. This breaks isolation, the product's sacred promise.

## The standard fix (apply consistently — this is also the reference pattern for the future useLatestAsync primitive, see docs/strategy/2026-07-05-async-into-state-hardening-plan.md)
Per site: capture the target id(s) + a monotonic request token at action START; after EVERY await that precedes a state/store write, `return` unless (a) the request is still the latest AND (b) the captured target id still matches the current one. For workspace indexing: pass the captured root through, never re-read the global current root after an await.

## The eight (QA-55/useAsk is EXCLUDED — folded into Tier C P1; do NOT touch useAsk.ts)
1. **QA-52 P0** WorkspaceSelector.tsx:247/308/320-328 — openRequestId guard before setRootPath/setFileTree/onWorkspaceSelected.
2. **QA-53 P0** EmailViewer.tsx:241/261 — capture sourceId/message.id, re-check before setMessage/setReplyDraft/errors/loading.
3. **QA-54 P0 (biometric)** VoiceprintsCard.tsx:17/21 — request token + clear items/confirming on workspaceRoot/matterId change + bind matterId into pending delete.
4. **QA-56 P1** SourcePanel.tsx:130 — capture {id,matterId,excerpt}, setVerdict only if same citation.
5. **QA-57 P1** PrivilegeExclusionExplainer.tsx:72 — token per demo run / compare current query+scope before setDemo.
6. **QA-58 P1/P2** MemoryFactsSettings.tsx:55 — workspace-generation token, drop stale; guard handleAdd/handleDelete refresh too.
7. **QA-59 P2** RunOnAllButton.tsx:123/167 — request id around setResults + setAnalysis.
Each gets a red-first test proving the stale callback is DROPPED (fake the late resolution after a target switch; assert no wrong-target write).

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate. Per-finding red-first test. Handoff: which confirmed, gate counts, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/race-p0`

## Landmines
Do NOT touch useAsk.ts (QA-55 → Tier C P1), DocxEditor (cleanup4), useMemoryWiring (swallowp0), the CRM/email OUTBOUND path (Tier B just merged — EmailViewer's inbound file/draft is different, but check). Never rename matter_id/Matter. No interactive menus.
