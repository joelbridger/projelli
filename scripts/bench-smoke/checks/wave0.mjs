// scripts/bench-smoke/checks/wave0.mjs — Wave 0: Draft follow-up modal +
// Client Map review tray, from RUN-LOG.md's "Wave 0" section. Assumes a docx
// note is already the active tab (the harness doesn't open files — that's
// setup/precondition, reported as SETUP-BLOCKED if missing).
import { STATUS, makeResult } from '../result.mjs';
import { withGuard, requireSnapshot, findByTestId, findByText } from './_util.mjs';

const ID = 'wave0-draft-followup';
const SECTION = 'Wave 0 — Draft follow-up, Client Map review tray';

export const checkDraftFollowupAndReviewTray = withGuard(ID, SECTION, async ({ driver }) => {
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

  const postClickElements = await requireSnapshot(driver);
  const citationChip = findByText(postClickElements, /citation|source|cited/i);
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
  const reviewTray = findByText(postClickElements, /updates to review|accept|dismiss/i);

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
