# Fix brief — QA-41 (P1, the LAST Meetings blocker): notes never generate — the swallowed transcript read

**Lane:** cc-lantern-notesfix2 · dir `~/lp-notesfix2` (own worktree, branch `lp/notes-read-fix`). **Model:** Sonnet 5 · high.
**Read FIRST:** BUG-DB QA-41 + `docs/evidence/meetings-verify4-20260704/RUN-LOG.md` (on lp/windows-smoke-evidence — the bench's code-trace + 19 screenshots). **Rules:** NO-SHORTCUTS. TDD — reproduce red-first at the unit level (a transcript.json read that rejects → currently produces the eternal "queued" state). Codex self-review foreground/watched. PULL + reconcile before handoff. Unique dev-server port.

## Lane boundary (three lanes live)
noticekit owns ConsentDialog/consent ledger/policy surfaces — it was explicitly told NOT to edit tryGenerateNotes; that function is YOURS. qafix5 owns the document SAVE path (WorkspaceService write/autosave) — you may READ via WorkspaceService but don't modify its write plumbing. qafix6 owns keychain/startup. If you must cross a boundary: `COORDINATOR:` plain text, stop.

## The bug (confirmed on a clean session, real hardware)
After transcription completes (transcript.json on disk, correct), notes stay "being written" forever: no error, no retry, no provider request ever fired. The bench's trace: `tryGenerateNotes()` in meetingStore.ts reads transcript.json and, on a read failure, silently returns/treats the meeting as still-queued — permanently. The QA-31 watchdog + honest-error state only wrap the provider call downstream, so this earlier failure never surfaces. KEY QUESTION you must answer with proof: **why does the read fail on the real desktop when the file exists?** (Suspects: Windows path shape mismatch between the path the meeting record stores and what WorkspaceService/pathguard resolves; a read happening against a stale/incorrect matterFolder; a text-vs-binary read mismatch; a permissions/timing issue right after the transcription writer finishes. This repo has deep history on Windows path shapes — check lp/pathguard-windows-verbatim lessons.) The bug MAY be desktop-only — your unit repro can still force the read to fail; root-causing the real-world read failure needs code-reading + maybe a targeted Rust/TS path test. State what you proved vs. inferred.

## What to build
1. Fix the actual read failure so notes generate on the real desktop path (the root cause, not just the symptom).
2. Regardless of cause: NO silent swallowing anywhere in tryGenerateNotes — every failure path (read, parse, provider, write) must land in the same classified notesError + honest UI + retry machinery QA-31 built. The "still queued" state must be impossible once transcription is complete: it either progresses, or it errors honestly.
3. Tests: red-first unit repro (read rejects → classified error + retry available, NOT eternal queued); parse-failure case; a regression test tying transcription-complete → notes attempt always reaches a terminal state (success or classified error) within the watchdog bound.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate · Rust-touched ⇒ own CARGO_TARGET_DIR=$HOME/.cargo-target-lp-notesfix2, timeout 1200, one cargo box-wide (two other lanes may compile — expect lock waits). Handoff: HEAD SHA · PROVEN root cause of the real read failure (or the honest "forced-failure fixed, real trigger inferred as X" statement) · gate counts · Rust yes/no · self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/notes-read-fix`
