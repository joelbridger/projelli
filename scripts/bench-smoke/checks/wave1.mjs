// scripts/bench-smoke/checks/wave1.mjs — Wave 1: calendar sync -> meeting
// matching -> before-you-meet brief, from RUN-LOG.md's "Wave 1" section.
// Export-to-Word is deliberately NOT asserted here: RUN-LOG documented it as
// a real native Windows Save-As dialog outside the WebView2/CDP surface this
// harness can see, so it can't be verified this way without the pyautogui
// native-dialog agent (scripts/legion_agent.py) — out of scope for this pass.
import { STATUS, makeResult } from '../result.mjs';
import { withGuard, requireSnapshot, findByText } from './_util.mjs';

const ID = 'wave1-calendar-brief-export';
const SECTION = 'Wave 1 — Calendar sync, meeting matching, briefs, exports';

export const checkCalendarBriefExport = withGuard(ID, SECTION, async ({ driver }) => {
  const elements = await requireSnapshot(driver);
  const syncButton = findByText(elements, /^sync now$/i);
  if (!syncButton) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No "Sync now" control found — Calendar connector may not be connected on this bench yet.',
    });
  }

  // Note: if more than one connector card exposes "Sync now" (Calendar +
  // Wealthbox both do, per RUN-LOG's "ambiguous textContent" note), this
  // harness must be pointed at the Calendar card specifically once its own
  // testid is known — tracked as a follow-up, not guessed here.
  await driver.click(syncButton.testid ?? undefined);

  const synced = await driver.waitFor('Synced', 20);
  if (!synced.found) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: `Clicked Sync now but no "Synced ..." confirmation appeared within 20s: ${synced.error}`,
    });
  }

  const todayStrip = await driver.waitFor('Today', 10);
  const briefElements = await requireSnapshot(driver);
  const briefCitation = findByText(briefElements, /citation|source|cited/i);

  const shot = await driver.captureScreenshot('wave1-calendar-sync-brief');

  if (!todayStrip.found) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.FAIL,
      detail: 'Sync confirmed, but no "Today" meetings strip appeared afterward.',
      screenshots: [shot],
    });
  }

  return makeResult({
    id: ID,
    section: SECTION,
    status: STATUS.PASS,
    detail: briefCitation
      ? 'Calendar sync confirmed, Today strip populated, and a cited brief element is present.'
      : 'Calendar sync confirmed and Today strip populated. No brief/citation text visible yet in this snapshot — brief generation may need a matched meeting selected first (precondition, not asserted here).',
    screenshots: [shot],
  });
});
