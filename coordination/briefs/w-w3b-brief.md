# Worker brief — Wave 3 Phase 3b: local transcription pipeline (Tasks 7, 8, 9)

**Lane:** cc-lantern-w3b · worktree `~/lp-w3b` · branch `lp/wave3-transcription`
**Model:** Sonnet 5 · high. **CARGO_TARGET_DIR:** `$HOME/.cargo-target-lp-w3b` (seeded warm). `timeout 1200` on all cargo. tdd skill applies.

## Context (read in this order)
1. `docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md` — **Tasks 7, 8, 9 are your exact scope** (lines ~1397–1925). The plan is unusually detailed — follow it precisely; verify its line-number references against current code (the capture engine merged since it was written: `src-tauri/src/commands/capture/` is live, tasks 1–6 done, device-verified).
2. The capture engine you're building on: `capture/{engine,chunks,session,recovery,sources,mod}.rs`. NOTE (post-plan changes): path guards now live in `commands::pathguard` (plan may reference retention::sweep — re-point); `transcribe_meeting` and every dir-input command MUST call `guard_meeting_path` per the plan's wiring requirement.

## Scope
- **Task 7:** windowed transcription queue (≤25s windows over the existing per-request Parakeet/whisper sidecar — hard 30s cap in voice.rs), channel-attributed merge into `transcript.json` (mic="You", loopback="Them").
- **Task 8:** `transcribe_meeting` command + sidecar wiring + the shared TS types in `src/platform/types/meeting.ts` (the ONE place for this schema — Rust mirrors with serde camelCase). Push this task's commit EARLY (the parallel frontend lane builds against these types).
- **Task 9:** battery-saver mode + the audio import path.

## Rules
- The plan's schema decisions are locked — no redesigns. No cloud transcription EVER (local sidecar only). Never rename Matter/matter_id.
- A parallel frontend lane (cc-lantern-w3c) is building Tasks 10-13 against the same plan; you own `src-tauri/**` + `src/platform/types/meeting.ts`; they own `src/features/meetings/**` — do not cross into their files (flag overlaps to the coordinator instead).
- Gates per task: scoped cargo tests red→green, then full `cargo test --lib`; tsc for the types file. Codex self-review per task commit; cap ~4 rounds or 2 low-severity.
- Push after each task lands green. Evidence handoff with exact outputs. Last line exactly: `WORKER-DONE: lp/wave3-transcription`
