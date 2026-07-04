// scripts/bench-smoke/checks/wave2.mjs — Wave 2: Send to Wealthbox, from
// RUN-LOG.md's "Wave 2" section. SAFETY DEFAULT: read-only/queue-only. The
// non-live check stops the instant the review card renders — it never clicks
// Approve, never sends anything to a real CRM. Approve is a SEPARATE checklist
// entry (wave2-wealthbox-approve-live) that only runs under --live, and must
// only ever be pointed at a sandbox Wealthbox connection (see docs/qa/
// BENCH-SMOKE-HARNESS.md — this is documented there as sandbox-only, not
// enforced in code since the harness has no way to know which Wealthbox
// token a bench is using).
import { STATUS, makeResult } from '../result.mjs';
import {
  withGuard,
  requireSnapshot,
  findByTestId,
  findByText,
  clickElement,
  openSmokeClientDocuments,
  openSmokeClientDocumentsSubtab,
  openSmokeClientNote,
} from './_util.mjs';
import { SMOKE_CLIENT_MATTER_ID, SMOKE_NOTE_FILENAME_SECONDARY } from './smoke-workspace.mjs';

const ID = 'wave2-wealthbox-queue-review';
const SECTION = 'Wave 2 — Send to Wealthbox (queue/review only)';

export const checkWealthboxQueueAndReview = withGuard(ID, SECTION, async ({ driver }) => {
  // Each navigation step is tried INDEPENDENTLY — see wave0.mjs / setup.mjs
  // for the same pattern and root cause (a single try/catch around all
  // steps silently skips openSmokeClientNote whenever a prior check already
  // left a client hub open on a different sub-tab).
  try {
    await openSmokeClientDocuments(driver, { matterId: SMOKE_CLIENT_MATTER_ID });
  } catch {
    // Ignored — see comment above.
  }
  try {
    await openSmokeClientDocumentsSubtab(driver);
  } catch {
    // Ignored — see comment above.
  }
  try {
    await openSmokeClientNote(driver, { fileName: SMOKE_NOTE_FILENAME_SECONDARY });
  } catch {
    // Ignored — see comment above.
  }

  const elements = await requireSnapshot(driver);
  const sendButton = findByTestId(elements, 'docx-send-to-wealthbox');
  if (!sendButton) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail:
        'No [data-testid="docx-send-to-wealthbox"] button in the current view. This is exactly the smoke-2 P0 #5 symptom when it is a real regression ' +
        '(button silently absent instead of disabled) — but it is equally expected if no docx note tab is open. Treated as SETUP-BLOCKED, not FAIL, ' +
        'because this harness cannot distinguish "no note open" from "matter-resolution broke again" without a known-good precondition. ' +
        'If a note IS confirmed open when this fires, escalate as a P0 regression of the matter-resolution fix (docs/evidence/windows-smoke-2/RUN-LOG.md, Wave 2).',
    });
  }

  await driver.click('docx-send-to-wealthbox');

  // Harness-honesty fix: a prior version gated PASS on
  // driver.waitFor('review card', 15) — a whole-page substring text match.
  // The toolbar's OWN confirmation copy ("...Wealthbox review card...")
  // satisfied that match all by itself, so this check could PASS having
  // only ever seen the toast, never the real card. waitFor here is now
  // purely a non-authoritative settle delay (give the re-render a moment);
  // the actual PASS/FAIL decision below is the REAL card's own testid.
  await driver.waitFor('Update Wealthbox', 15);

  const postClick = await requireSnapshot(driver);
  const collapsedCard = findByTestId(postClick, 'crm-write-card-collapsed');
  const shot = await driver.captureScreenshot('wave2-send-to-wealthbox-review-card');

  if (!collapsedCard) {
    const linkPrompt = findByText(postClick, /link this client to a wealthbox household/i);
    if (linkPrompt) {
      return makeResult({
        id: ID,
        section: SECTION,
        status: STATUS.SETUP_BLOCKED,
        detail: 'Send to Wealthbox is wired up correctly, but this client is not yet linked to a Wealthbox household on this bench (expected first-run state, not a defect).',
        screenshots: [shot],
      });
    }
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail:
        'Clicked Send to Wealthbox but the real review card ([data-testid="crm-write-card-collapsed"]) never appeared. ' +
        'A confirmation toast alone does not count — this check used to false-PASS on that toast\'s own "review card" copy.',
      screenshots: [shot],
    });
  }

  await clickElement(driver, collapsedCard);
  const expanded = await requireSnapshot(driver);
  const approveButton = findByText(expanded, /approve \d+ change|^approve$/i);
  const expandedShot = await driver.captureScreenshot('wave2-send-to-wealthbox-review-card-expanded');

  if (!approveButton) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: 'The review card appeared and was expanded, but no Approve control was reachable inside it.',
      screenshots: [shot, expandedShot],
    });
  }

  return makeResult({
    id: ID,
    section: SECTION,
    status: STATUS.PASS,
    detail:
      'Send to Wealthbox queues a REAL review card ([data-testid="crm-write-card-collapsed"]) that expands to a ' +
      'reachable Approve control. Stopped here by design (read-only default) — no Approve/send.',
    screenshots: [shot, expandedShot],
  });
});

const APPROVE_ID = 'wave2-wealthbox-approve-live';

export const checkWealthboxApproveLive = withGuard(APPROVE_ID, SECTION, async ({ driver, live }) => {
  if (!live) {
    return makeResult({
      id: APPROVE_ID,
      section: SECTION,
      status: STATUS.SKIPPED,
      detail: 'Skipped: requires --live (this run did not pass it). SANDBOX-ONLY — never point --live at a bench connected to a real/production Wealthbox account.',
    });
  }

  const elements = await requireSnapshot(driver);
  const approveButton = findByText(elements, /approve \d+ change|^approve$/i);
  if (!approveButton) {
    return makeResult({
      id: APPROVE_ID,
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No Approve control found — run wave2-wealthbox-queue-review first to reach the review card.',
    });
  }

  await clickElement(driver, approveButton);

  const sentWait = await driver.waitFor('sent', 15);
  const shot = await driver.captureScreenshot('wave2-wealthbox-approved-sent');

  if (!sentWait.found) {
    return makeResult({
      id: APPROVE_ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: `Clicked Approve but no "sent" confirmation appeared within 15s: ${sentWait.error}`,
      screenshots: [shot],
    });
  }

  return makeResult({
    id: APPROVE_ID,
    section: SECTION,
    status: STATUS.PASS,
    detail: 'Approved the queued card and the app confirmed it was sent. (--live, sandbox CRM only.)',
    screenshots: [shot],
  });
});
