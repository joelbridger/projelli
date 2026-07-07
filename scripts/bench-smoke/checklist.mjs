// scripts/bench-smoke/checklist.mjs — the ordered list of checks, 1:1 with
// the section headings in docs/evidence/windows-smoke-2/RUN-LOG.md (the
// manual smoke checklist this harness automates). Pure data + the runner's
// dispatch table; no I/O here, so `--plan` (and its test) never touch a bench.
import * as setupChecks from './checks/setup.mjs';
import * as wave0Checks from './checks/wave0.mjs';
import * as wave1Checks from './checks/wave1.mjs';
import * as wave2Checks from './checks/wave2.mjs';
import * as wave4Checks from './checks/wave4.mjs';
import * as crossCuttingChecks from './checks/crosscutting.mjs';
import { WAVE_3_STUBS, WAVE_4_STUBS } from './checks/wave-stubs.mjs';

// Each live (non-stub) entry: { id, section, title, liveOnly, run }.
// `run(ctx)` -> a single result object built with makeResult(); `liveOnly`
// checks are skipped (not run) unless the harness was invoked with --live.
export const CHECKLIST = [
  { id: 'workspace-binding', section: 'Phase 1 — setup', title: 'Workspace folderPaths rebind reflects in Clients management + Documents tab', liveOnly: false, run: setupChecks.checkWorkspaceBinding },
  { id: 'per-client-files-visible', section: 'Phase 1 — setup', title: 'Documents tab is scoped to the selected client only (no cross-client leakage)', liveOnly: false, run: setupChecks.checkPerClientFilesVisible },
  { id: 'index-health', section: 'Phase 1 — setup', title: 'Client Map shows cited facts with no "memory integrity uncertain" error', liveOnly: false, run: setupChecks.checkIndexHealth },

  { id: 'wave0-draft-followup', section: 'Wave 0 — Draft follow-up, Client Map review tray', title: 'Draft follow-up modal generates a cited draft; Client Map review tray Accept/Dismiss works', liveOnly: false, run: wave0Checks.checkDraftFollowupAndReviewTray },

  { id: 'wave1-calendar-brief-export', section: 'Wave 1 — Calendar sync, meeting matching, briefs, exports', title: 'Sync now → meeting appears → assign client → before-you-meet brief renders with citations', liveOnly: false, run: wave1Checks.checkCalendarBriefExport },

  { id: 'wave2-wealthbox-queue-review', section: 'Wave 2 — Send to Wealthbox (queue/review only)', title: 'Send to Wealthbox button renders on a resolvable note and queues a review card', liveOnly: false, sameTargetGroup: 'wave2-wealthbox', run: wave2Checks.checkWealthboxQueueAndReview },
  { id: 'wave2-wealthbox-approve-live', section: 'Wave 2 — Send to Wealthbox (queue/review only)', title: '[--live only, sandbox CRM] Approve the queued card and confirm it posts', liveOnly: true, sameTargetGroup: 'wave2-wealthbox', run: wave2Checks.checkWealthboxApproveLive },

  { id: 'wave4-all-clients-hub', section: 'Wave 4 — Depth (Track B: All Clients hub)', title: 'Rail All Clients opens the client table; a client row opens the client hub', liveOnly: false, run: wave4Checks.checkAllClientsHub },
  { id: 'wave4-estate-beneficiary-gap', section: 'Wave 4 — Depth (Track B: estate/beneficiary gap detection)', title: 'Opening clients from All Clients finds a resolvable Client Map gap row', liveOnly: false, sameTargetGroup: 'wave4-estate-beneficiary-gap', run: wave4Checks.checkEstateBeneficiaryGap },
  { id: 'wave4-estate-beneficiary-gap-dismiss-live', section: 'Wave 4 — Depth (Track B: estate/beneficiary gap detection)', title: '[--live only] Dismissing the gap via its Client Map resolve control clears it', liveOnly: true, sameTargetGroup: 'wave4-estate-beneficiary-gap', run: wave4Checks.checkEstateBeneficiaryGapDismissLive },
  { id: 'wave4-whole-practice-ask', section: 'Wave 4 — Depth (Track C: whole-practice Ask + consent gate)', title: 'Ask "Whole practice" scope pill renders; cross-client consent gate appears when required', liveOnly: false, run: wave4Checks.checkWholePracticeAsk },

  { id: 'cross-cutting-light-theme', section: 'Cross-cutting', title: 'App theme is Light everywhere visited', liveOnly: false, run: crossCuttingChecks.checkLightTheme },
  { id: 'cross-cutting-console-errors', section: 'Cross-cutting', title: 'No console errors while navigating Client Map / Documents / Settings', liveOnly: false, run: crossCuttingChecks.checkConsoleErrors },
  { id: 'cross-cutting-egress-indicator', section: 'Cross-cutting', title: 'Local-only mode flips the egress indicator correctly, then reverts', liveOnly: false, run: crossCuttingChecks.checkEgressIndicator },
];

// Stubs are pure data, never executed — the runner reports each as STATUS.TODO
// without touching the bench. Filled in by the Wave-3/Wave-4 lanes' own bench
// verification once those features have UI surfaces to drive.
export const STUBS = [...WAVE_3_STUBS, ...WAVE_4_STUBS];

export function allCheckIds() {
  return [...CHECKLIST.map((c) => c.id), ...STUBS.map((c) => c.id)];
}

export function findCheck(id) {
  return CHECKLIST.find((c) => c.id === id) ?? STUBS.find((c) => c.id === id);
}
