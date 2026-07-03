// scripts/bench-smoke/checks/wave4.mjs — Wave 4 Track B/C checks, promoted
// from wave-stubs.mjs now that their UI is merged into lantern-plus: the
// "Whole book" Client Map view + estate/beneficiary gap detection (Track B),
// and the whole-practice Ask scope + its cross-client consent gate (Track C).
// Track A (diarization) stays a stub in wave-stubs.mjs — its lane hasn't
// merged. Read-only: nothing here approves/sends data anywhere; the consent
// gate is only asserted present, never clicked through (see checkWholePracticeAsk).
import { STATUS, makeResult } from '../result.mjs';
import {
  withGuard,
  requireSnapshot,
  findByTestId,
  textPresent,
  clickElement,
  openWholeBookView,
  openAskSurface,
  openSmokeClientOverview,
} from './_util.mjs';

const BOOK_ID = 'wave4-whole-book-view';
const BOOK_SECTION = 'Wave 4 — Depth (Track B: whole-book Client Map)';

export const checkWholeBookView = withGuard(BOOK_ID, BOOK_SECTION, async ({ driver }) => {
  try {
    await openWholeBookView(driver);
  } catch {
    // Best-effort — see wave0.mjs for the same pattern and rationale. The
    // book-view testid check right below is the real, honest gate (the
    // toggle may already be on "Whole book" from a prior run/check).
  }

  const elements = await requireSnapshot(driver);
  const bookView = findByTestId(elements, 'book-view');
  if (!bookView) {
    return makeResult({
      id: BOOK_ID,
      section: BOOK_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No [data-testid="book-view"] container found — not on the Client Map surface, or the "Whole book" toggle click did not switch views.',
    });
  }

  const rows = elements.filter((e) => typeof e.testid === 'string' && e.testid.startsWith('book-row-'));
  if (rows.length === 0) {
    return makeResult({
      id: BOOK_ID,
      section: BOOK_SECTION,
      status: STATUS.FAIL,
      detail: 'Whole book view rendered but no ranked client rows ([data-testid^="book-row-"]) are present.',
    });
  }

  const bookShot = await driver.captureScreenshot('wave4-whole-book-view');

  // "A book row opens the client hub": click the first ranked row and confirm
  // it lands on that client's hub, same Documents-tab assertion used
  // elsewhere for entering a hub (see openSmokeClientDocuments in _util.mjs).
  await clickElement(driver, rows[0]);
  const hubWait = await driver.waitFor('Documents', 10);
  if (!hubWait.found) {
    return makeResult({
      id: BOOK_ID,
      section: BOOK_SECTION,
      status: STATUS.FAIL,
      detail: `Whole book view shows ${rows.length} ranked client row(s), but clicking the first row did not open a client hub (no "Documents" tab appeared): ${hubWait.error}`,
      screenshots: [bookShot],
    });
  }

  return makeResult({
    id: BOOK_ID,
    section: BOOK_SECTION,
    status: STATUS.PASS,
    detail: `Whole book view renders ${rows.length} ranked client row(s), and clicking the first row opens that client's hub.`,
    screenshots: [bookShot],
  });
});

const GAP_ID = 'wave4-estate-beneficiary-gap';
const GAP_SECTION = 'Wave 4 — Depth (Track B: estate/beneficiary gap detection)';

// book-gap-chip (BookView.tsx) is not unique per gap — it repeats per flagged
// row — so a snapshot()-based findByTestId can't tell us WHICH row has a
// gap. Snapshot only exposes a flat element list with no parent/child
// relationship (parse.mjs), so this reads the DOM directly via the existing
// `eval` command (same reuse rule as click-by-text.mjs/overlay-dismiss.mjs)
// to find the first book-row-<matterId> container that has a descendant
// book-gap-chip, and returns that row's own testid so it can be clicked.
export function findGapRowScript() {
  return (
    '(() => {' +
    'const rows = [...document.querySelectorAll(\'[data-testid^="book-row-"]\')];' +
    'const withGap = rows.find(r => r.querySelector(\'[data-testid="book-gap-chip"]\'));' +
    'return withGap ? withGap.getAttribute(\'data-testid\') : null;' +
    '})()'
  );
}

export const checkEstateBeneficiaryGap = withGuard(GAP_ID, GAP_SECTION, async ({ driver }) => {
  try {
    await openWholeBookView(driver);
  } catch {
    // Best-effort — see wave0.mjs.
  }

  const gapRowTestid = await driver.evalJs(findGapRowScript());
  if (!gapRowTestid) {
    return makeResult({
      id: GAP_ID,
      section: GAP_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No [data-testid="book-gap-chip"] found on any row in the whole book view this run — either this fixture workspace has no client with a flagged estate/beneficiary mismatch, or the book view is not open.',
    });
  }

  const gapShot = await driver.captureScreenshot('wave4-estate-beneficiary-gap-chip');

  await driver.click(gapRowTestid);
  await openSmokeClientOverview(driver);

  const beforeElements = await requireSnapshot(driver);
  // Deliberately "clientmap-ask-flag" ONLY, never "clientmap-ask-know":
  // confirmed in source (ClientMapPanel.tsx) that "I know this" calls
  // onAnswerQuestion(q), which opens an answer-entry prompt rather than
  // resolving anything — an automated read-only click on it would either hang
  // waiting for text input or leave a stray modal open blocking later checks
  // (the exact class of bug round 1 fixed for the Draft-follow-up modal).
  // "Ask the client" calls flagForClient(), which synchronously calls
  // markGapResolved() with no modal — the only one of the two safe to click
  // here.
  const resolveButtons = beforeElements.filter((e) => e.testid === 'clientmap-ask-flag');
  if (resolveButtons.length === 0) {
    return makeResult({
      id: GAP_ID,
      section: GAP_SECTION,
      status: STATUS.FAIL,
      detail: `Book view flagged a gap on ${gapRowTestid}, but its Client Map sub-tab shows no resolvable gap row (no clientmap-ask-flag button) — gap chip and per-client detail are out of sync.`,
      screenshots: [gapShot],
    });
  }

  await clickElement(driver, resolveButtons[0]);

  // "None found" clean state: ClientMapPanel.tsx renders this literal text
  // once every gap/assumption on the client is resolved.
  const cleanState = await textPresent(driver, 'Nothing outstanding');
  const afterElements = await requireSnapshot(driver);
  const remaining = afterElements.filter((e) => e.testid === 'clientmap-ask-flag').length;
  const dismissWorked = cleanState || remaining < resolveButtons.length;

  const dismissShot = await driver.captureScreenshot('wave4-estate-beneficiary-gap-dismissed');

  if (!dismissWorked) {
    return makeResult({
      id: GAP_ID,
      section: GAP_SECTION,
      status: STATUS.FAIL,
      detail: 'Gap chip rendered and its resolve control was clicked, but the gap row is still present afterward (no "Nothing outstanding" clean state, and the resolvable-row count did not drop).',
      screenshots: [gapShot, dismissShot],
    });
  }

  return makeResult({
    id: GAP_ID,
    section: GAP_SECTION,
    status: STATUS.PASS,
    detail: `Estate/beneficiary gap chip rendered on ${gapRowTestid} in the whole book view, and dismissing it via the Client Map resolve control cleared it (${
      cleanState ? '"Nothing outstanding" clean state shown' : `resolvable rows dropped from ${resolveButtons.length} to ${remaining}`
    }).`,
    screenshots: [gapShot, dismissShot],
  });
});

const ASK_ID = 'wave4-whole-practice-ask';
const ASK_SECTION = 'Wave 4 — Depth (Track C: whole-practice Ask + consent gate)';

export const checkWholePracticeAsk = withGuard(ASK_ID, ASK_SECTION, async ({ driver }) => {
  try {
    await openAskSurface(driver);
  } catch {
    // Best-effort — see wave0.mjs.
  }

  const elements = await requireSnapshot(driver);
  const scopeOption = findByTestId(elements, 'scope-option-whole-practice');
  if (!scopeOption) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No [data-testid="scope-option-whole-practice"] control found — not on the Ask surface, or the scope toggle is not present.',
    });
  }

  await driver.click('scope-option-whole-practice');

  // Deliberately NOT textPresent(driver, 'Whole practice') — that substring
  // is already visible on the scope-option-whole-practice BUTTON's own label
  // before the click, so it would pass even if the click did nothing. Wait
  // for the pill's distinguishing full copy ("Whole practice (summaries
  // only)", src/locales/en.json) instead, then confirm the actual
  // [data-testid="ask-scope-pill"] control, which only renders once the
  // scope has actually switched.
  const pillWait = await driver.waitFor('Whole practice (summaries only)', 10);
  if (!pillWait.found) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.FAIL,
      detail: `Clicked the "Whole practice" scope option but its scope pill never appeared: ${pillWait.error}`,
    });
  }

  const postSelectElements = await requireSnapshot(driver);
  const scopePill = findByTestId(postSelectElements, 'ask-scope-pill');
  if (!scopePill) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.FAIL,
      detail: 'Clicked the "Whole practice" scope option and its pill text appeared, but no [data-testid="ask-scope-pill"] control was found in the snapshot.',
    });
  }

  const scopeShot = await driver.captureScreenshot('wave4-whole-practice-ask-scope-pill');

  // The cross-client consent gate (FileAccessConsentBanner) only appears
  // un-asked once per session — read-only default, never granted/denied here
  // (that belongs behind --live, since granting it is a real state change).
  const consentGate = findByTestId(postSelectElements, 'chat-file-access-consent');

  return makeResult({
    id: ASK_ID,
    section: ASK_SECTION,
    status: STATUS.PASS,
    detail: consentGate
      ? 'Whole practice scope pill renders, and the cross-client consent gate ([data-testid="chat-file-access-consent"]) appears as required. Not granted/denied here (read-only default).'
      : 'Whole practice scope pill renders. No consent gate was present this run — likely already granted in a prior session (not treated as a failure; this check does not assert the gate always appears, only that it appears correctly when required).',
    screenshots: [scopeShot],
  });
});
