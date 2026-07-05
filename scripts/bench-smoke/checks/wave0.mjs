// scripts/bench-smoke/checks/wave0.mjs — Wave 0: Draft follow-up modal +
// Client Map review tray, from RUN-LOG.md's "Wave 0" section. Best-effort
// opens the known smoke-test note first (see smoke-workspace.mjs); if that
// navigation doesn't land on a docx tab, reports SETUP-BLOCKED rather than
// guessing.
import { STATUS, makeResult } from '../result.mjs';
import {
  withGuard,
  requireSnapshot,
  findByTestId,
  textPresent,
  openSmokeClientDocuments,
  openSmokeClientDocumentsSubtab,
  openSmokeClientNote,
} from './_util.mjs';
import { SMOKE_CLIENT_MATTER_ID, SMOKE_NOTE_FILENAME } from './smoke-workspace.mjs';

const ID = 'wave0-draft-followup';
const SECTION = 'Wave 0 — Draft follow-up, Client Map review tray';

export const checkDraftFollowupAndReviewTray = withGuard(ID, SECTION, async ({ driver }) => {
  // Each navigation step is tried INDEPENDENTLY, not one try/catch around
  // all of them — same fix, and same root cause, as setup.mjs's
  // primeClientView (see its comment for the full story). matter-launch-
  // documents-<id> only exists in the Client Map TABLE view; if a prior
  // check (e.g. index-health) already left a client hub open on a
  // different sub-tab, that click throws — which used to also skip
  // openSmokeClientNote below even though the hub's own Documents sub-tab
  // (reachable independently via hub-subtab-documents) is all
  // openSmokeClientNote actually needs. The docx-draft-follow-up testid
  // check right below remains the real, honest gate either way.
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
    await openSmokeClientNote(driver, { fileName: SMOKE_NOTE_FILENAME });
  } catch {
    // Ignored — see comment above.
  }

  const elements = await requireSnapshot(driver);
  const draftButton = findByTestId(elements, 'docx-draft-follow-up');
  if (!draftButton) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No [data-testid="docx-draft-follow-up"] button in the current view — no docx note tab is open, or the toolbar has not rendered yet.',
    });
  }

  await driver.click('docx-draft-follow-up');

  const modalWait = await driver.waitFor('Follow-up', 15);
  if (!modalWait.found) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: `Clicked Draft follow-up but no "Follow-up" modal text appeared within 15s: ${modalWait.error}`,
    });
  }

  const citationChip = await textPresent(driver, 'cited');
  const draftShot = await driver.captureScreenshot('wave0-draft-followup-modal');

  if (!citationChip) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: 'Draft follow-up modal opened, but no citation chip text was found in the generated draft.',
      screenshots: [draftShot],
    });
  }

  // Client Map review tray is a separate surface from the modal just opened;
  // check its presence non-fatally (report within the same result's detail)
  // rather than failing the whole check if the modal is still open on top of it.
  const reviewTray = await textPresent(driver, 'updates to review');

  return makeResult({
    id: ID,
    section: SECTION,
    status: STATUS.PASS,
    detail: reviewTray
      ? 'Draft follow-up modal generated a cited draft, and the Client Map review tray (Accept/Dismiss) is present.'
      : 'Draft follow-up modal generated a cited draft. Review-tray text was not visible in this snapshot (may be behind the modal) — not treated as a failure since the modal itself is the primary assertion.',
    screenshots: [draftShot],
  });
});
