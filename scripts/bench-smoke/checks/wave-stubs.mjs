// scripts/bench-smoke/checks/wave-stubs.mjs — TODO stubs for Wave 3 (local
// meeting capture) and Wave 4 (depth: book view, cross-client Ask,
// diarization). These waves either don't have bench-drivable UI yet (Wave 3's
// capture engine, Wave 4's diarization sidecar are backend/Rust-only so far)
// or their UI exists but the harness hasn't been wired to drive it yet — per
// the brief, that wiring is the Wave-3/Wave-4 lanes' own job during their
// bench verification, not this harness's. Acceptance text below is paraphrased
// from the plan docs; see the cited file for the authoritative spec.
import { makeResult, STATUS } from '../result.mjs';

function stub({ id, section, title, planRef, acceptance }) {
  return {
    id,
    section,
    title,
    liveOnly: false,
    planRef,
    acceptance,
    run: async () =>
      makeResult({
        id,
        section,
        status: STATUS.TODO,
        detail: `Not wired up yet — see ${planRef}. Acceptance to check once this wave has bench-drivable UI: ${acceptance}`,
      }),
  };
}

export const WAVE_3_STUBS = [
  stub({
    id: 'wave3-capture-start-stop',
    section: 'Wave 3 — Local meeting capture (STUB)',
    title: 'Start/stop a local meeting recording from the app UI',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md (Task 1, Task 4)',
    acceptance:
      'A "Start recording" control begins a dual-channel (mic + WASAPI loopback) capture and shows a visible recording indicator; "Stop" finalizes the session without dropping audio.',
  }),
  stub({
    id: 'wave3-capture-crash-recovery',
    section: 'Wave 3 — Local meeting capture (STUB)',
    title: 'An orphaned capture session is detected and recovered on next launch',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md (Task 5)',
    acceptance:
      'Killing the app mid-recording, then relaunching, surfaces the orphaned session (chunks already on disk) instead of silently losing it.',
  }),
  stub({
    id: 'wave3-capture-session-manifest',
    section: 'Wave 3 — Local meeting capture (STUB)',
    title: 'A finished capture produces a playable stereo audio.wav + manifest',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-3-meeting-capture.md (Task 2)',
    acceptance:
      'After Stop, the session finalizes chunks into a single stereo audio.wav plus a manifest the rest of the app (transcript, brief) can reference.',
  }),
];

export const WAVE_4_STUBS = [
  stub({
    id: 'wave4-whole-book-view',
    section: 'Wave 4 — Depth (STUB)',
    title: 'Client Map "Whole book" view ranks all clients with sourced facts / open gaps / last touch',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Track B, Task 1-2)',
    acceptance:
      'The Client Map "Clients | Whole book" toggle switches to a ranked list of every client, columns for Sourced Facts / Open Gaps / Last Touch.',
  }),
  stub({
    id: 'wave4-estate-beneficiary-gap',
    section: 'Wave 4 — Depth (STUB)',
    title: 'Estate/beneficiary designation gap is flagged on a client with a real inconsistency',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Task 2b)',
    acceptance:
      'A client whose beneficiary/estate documents are stale or inconsistent shows a gap chip on their Client Map; a client with none shows a clean "none found" cited answer.',
  }),
  stub({
    id: 'wave4-whole-practice-ask',
    section: 'Wave 4 — Depth (STUB)',
    title: 'Ask "Whole practice" scope answers a cross-client question with per-client citations',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Track C, Task 3-5)',
    acceptance:
      'Selecting the "Whole practice" scope pill (after granting the cross-client consent prompt) answers a practice-wide question with clickable client chips and per-fact citations, built only from each client\'s summary (never raw cross-matter RAG).',
  }),
  stub({
    id: 'wave4-diarization',
    section: 'Wave 4 — Depth (STUB)',
    title: 'A captured meeting is diarized (speakers separated/named)',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Track A, Task 6+)',
    acceptance:
      'A recorded meeting transcript shows separate, named (or nameable) speakers rather than one undifferentiated stream. Depends on Wave 3 capture existing first.',
  }),
];
