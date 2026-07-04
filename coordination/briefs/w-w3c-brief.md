# Worker brief — Wave 3 Phases 3c+3d core: the user-facing meetings surface (Tasks 10, 10b, 11, 12, 12b, 12c, 13)

**Lane:** cc-lantern-w3c · worktree `~/lp-w3c` · branch `lp/wave3-meetings-ui`
**Model:** Sonnet 5 · high. Mostly TS; if a task genuinely needs a new Rust command, flag to the coordinator first. tdd + frontend patterns of the repo apply.

## Context (read in this order)
1. `docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md` — **Tasks 10, 10b, 11, 12, 12b, 12c, 13 are your exact scope** (lines ~1926–2432). The plan is extremely detailed, down to tab placement and file names — follow it. Verify line refs against current code (capture engine merged; pathguard moved).
2. **Jameson's locked decisions in the plan:** meetings live on a per-client **Meetings tab** in the client hub tab row **between Email and Activity** (`HUB_TABS` in `src/features/matters/MatterHub.tsx`, id 'meetings', label 'Meetings', Icon Mic); the floating **record pill is the whole recording UI**; the Spine stays three tabs. Prototype: `docs/design/lantern-plus-prototypes/p6-client-meetings-tab.html`.
3. `src/features/meetings/SpeakerNamesPanel.tsx` already exists (Wave-4A diarization naming UI, currently orphaned) — wire it into your MeetingEntry surface where the plan's diarization hooks appear.

## Scope
- Task 10: meeting-note template through the existing Workflows engine, timestamp citations → real `.docx`.
- Task 10b: dictation notes → meeting pipeline ("File as meeting note…").
- Task 11: meeting SourceRefs into the Client Map.
- Task 12: `useMeetingStore` (startRecording→consent→capture_start; stopRecording→capture_stop→meeting.json→transcribe per setting→notes template→index; orphan check on launch → "Found a recording — finish the notes?" card), RecordPill, Meetings tab, MeetingEntry (notes docx left · TranscriptViewer right, audio seek), Activity timeline entries.
- Task 12b: "Needs review" section on the Meetings tab. Task 12c: meeting-type defaults (thin, no rules engine).
- Task 13: consent dialog + per-client consent ledger + audit entries (audit action strings: check `src/platform/types/audit.ts` — `meeting_capture_started` is the start action; extend the union only per plan).

## Coordination
- A parallel Rust lane (cc-lantern-w3b) is building Tasks 7-9 including the shared types file `src/platform/types/meeting.ts` — **they own that file and src-tauri/**; build against the plan's documented schema, and pull their branch's types commit as soon as they push it (coordinator will ping). `transcribe_meeting` won't exist until they land — stub the call behind the store's setting so your surface is testable without it (plan's transcribeMode gates this anyway).
- Light theme, i18n like neighbors (de/es), user-facing words are client/meeting never matter. Every user-visible sentence readable by a non-engineer.
- Gates per task: vitest red→green scoped, then full vitest + tsc + eslint-gate; add bench-mirror Playwright specs for the Meetings tab surfaces where browser-drivable. Codex per task; cap ~4 rounds.
- Push per task. Evidence handoff. Last line exactly: `WORKER-DONE: lp/wave3-meetings-ui`
