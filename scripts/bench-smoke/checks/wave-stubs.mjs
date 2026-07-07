// scripts/bench-smoke/checks/wave-stubs.mjs — TODO stubs for waves whose UI
// isn't bench-drivable yet. Wave 3 (local meeting capture) is backend/Rust-only
// so far. Wave 4 Track A (diarization) hasn't merged. Wave 4 Tracks B/C
// (All Clients hub + estate/beneficiary gaps, whole-practice Ask +
// consent gate) DID merge and are now real checks in wave4.mjs, not stubs
// here — see checklist.mjs. Acceptance text below is paraphrased from the
// plan docs; see the cited file for the authoritative spec.
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
    id: 'wave4-diarization',
    section: 'Wave 4 — Depth (STUB)',
    title: 'A captured meeting is diarized (speakers separated/named)',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Track A, Task 6+)',
    acceptance:
      'A recorded meeting transcript shows separate, named (or nameable) speakers rather than one undifferentiated stream. Depends on Wave 3 capture existing first.',
  }),
  stub({
    id: 'wave4-retention-attestation',
    section: 'Wave 4 — Depth (STUB)',
    title: 'Retention policy setting is visible and an attestation report exports',
    planRef: 'docs/plans/lantern-plus/2026-07-02-wave-4-depth.md (Track D, Task 16-17)',
    acceptance:
      'Settings > Privacy shows a "Meeting recordings" retention policy control (keep/delete-after choices) whose current state also appears on the Data Map dialog; an "Export attestation report" action produces a .docx summarizing consent, recordings, and deletions.',
  }),
];
