// scripts/bench-smoke/checks/wave1.mjs — Wave 1: calendar sync -> meeting
// matching -> before-you-meet brief, from RUN-LOG.md's "Wave 1" section.
// Export-to-Word is deliberately NOT asserted here: RUN-LOG documented it as
// a real native Windows Save-As dialog outside the WebView2/CDP surface this
// harness can see, so it can't be verified this way without the pyautogui
// native-dialog agent (scripts/legion_agent.py) — out of scope for this pass.
import { STATUS, makeResult } from '../result.mjs';
import { withGuard, requireSnapshot, findByTestId, textPresent, openAccountConnectionsTab } from './_util.mjs';

const ID = 'wave1-calendar-brief-export';
const SECTION = 'Wave 1 — Calendar sync, meeting matching, briefs, exports';

// The real data-testid for the Calendar connector's own Sync now button
// (src/platform/connectors/calendar/CalendarConnect.tsx) — used instead of a
// text match because RUN-LOG.md documented that the Wealthbox connector card
// renders identical "Sync now" text, and an ambiguous textContent selector
// mis-hit it twice during a real manual run.
const CALENDAR_SYNC_TESTID = 'calendar-sync-button';

export const checkCalendarBriefExport = withGuard(ID, SECTION, async ({ driver }) => {
  try {
    await openAccountConnectionsTab(driver);
  } catch {
    // Best-effort — see wave0.mjs for the same pattern and rationale. The
    // findByTestId check right below is the real, honest gate (the app may
    // already be on Account > Connections from a prior check/session).
  }

  const elements = await requireSnapshot(driver);
  const syncButton = findByTestId(elements, CALENDAR_SYNC_TESTID);
  if (!syncButton) {
    return makeResult({
      id: ID,
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: `No [data-testid="${CALENDAR_SYNC_TESTID}"] control found — Calendar connector may not be connected on this bench, or its Account/Connections view isn't open.`,
    });
  }

  await driver.click(CALENDAR_SYNC_TESTID);

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
  const briefCitation = await textPresent(driver, 'cited');

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
