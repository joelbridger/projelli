// scripts/bench-smoke/checks/wave4.mjs — Wave 4 Track B/C checks, promoted
// from wave-stubs.mjs now that their UI is merged into lantern-plus: the
// rail-pinned All Clients table + per-client hub behavior (Track B), and the
// hidden whole-practice Ask entry point + remaining scope toggle behavior
// (Track C).
// Track A (diarization) stays a stub in wave-stubs.mjs — its lane hasn't
// merged. Read-only: nothing here approves/sends data anywhere.
import { STATUS, makeResult } from '../result.mjs';
import {
  withGuard,
  requireSnapshot,
  findByTestId,
  textPresent,
  clickElement,
  openAllClientsTable,
  openAskSurface,
  openSmokeClientOverview,
} from './_util.mjs';

const ALL_CLIENTS_ID = 'wave4-all-clients-hub';
const ALL_CLIENTS_SECTION = 'Wave 4 — Depth (Track B: All Clients hub)';

function matterRows(elements) {
  return elements.filter((e) =>
    typeof e.testid === 'string' &&
    e.testid.startsWith('matter-row-') &&
    !e.testid.startsWith('matter-row-shell-')
  );
}

async function hubIsOpen(driver) {
  const result = await driver.evalJs(
    '!!document.querySelector(\'[data-testid="hub-subtab-bar"]\') && !!document.querySelector(\'[data-testid="hub-subtab-panel-overview"]\')',
  );
  return result === true;
}

export const checkAllClientsHub = withGuard(ALL_CLIENTS_ID, ALL_CLIENTS_SECTION, async ({ driver }) => {
  try {
    await openAllClientsTable(driver);
  } catch {
    // Best-effort — the testid checks right below are the real gate.
  }

  const elements = await requireSnapshot(driver);
  const allClientsRow = findByTestId(elements, 'spine-all-clients-row');
  if (!allClientsRow) {
    return makeResult({
      id: ALL_CLIENTS_ID,
      section: ALL_CLIENTS_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No [data-testid="spine-all-clients-row"] found — the permanent All Clients rail entry is missing or hidden.',
    });
  }

  const rows = matterRows(elements);
  if (rows.length === 0) {
    return makeResult({
      id: ALL_CLIENTS_ID,
      section: ALL_CLIENTS_SECTION,
      status: STATUS.FAIL,
      detail: 'All Clients opened, but no client table rows ([data-testid^="matter-row-"]) are present.',
    });
  }

  const tableShot = await driver.captureScreenshot('wave4-all-clients-table');

  // A client row opens that client's hub.
  await clickElement(driver, rows[0]);
  const hubWait = await driver.waitFor('Documents', 10);
  const hubOpen = await hubIsOpen(driver);
  if (!hubWait.found || !hubOpen) {
    return makeResult({
      id: ALL_CLIENTS_ID,
      section: ALL_CLIENTS_SECTION,
      status: STATUS.FAIL,
      detail: `All Clients shows ${rows.length} client row(s), but clicking the first row did not open a client hub: ${hubWait.error ?? 'hub sub-tab bar was not present'}`,
      screenshots: [tableShot],
    });
  }

  return makeResult({
    id: ALL_CLIENTS_ID,
    section: ALL_CLIENTS_SECTION,
    status: STATUS.PASS,
    detail: `All Clients renders ${rows.length} client row(s), and clicking the first row opens that client's hub.`,
    screenshots: [tableShot],
  });
});

const GAP_ID = 'wave4-estate-beneficiary-gap';
const GAP_SECTION = 'Wave 4 — Depth (Track B: estate/beneficiary gap detection)';

// Read-only by design (Codex-review finding): this check used to click
// clientmap-ask-flag on every normal run, which synchronously resolves the
// gap (flagForClient -> markGapResolved) — a real fixture mutation on a
// supposedly read-only pass, and it would make the gap silently disappear
// for the NEXT run. It now only asserts the per-client gap resolve control
// exists; the actual dismiss-and-verify is a separate, --live-gated check
// below, same pattern as wave2.mjs's wave2-wealthbox-approve-live.
export const checkEstateBeneficiaryGap = withGuard(GAP_ID, GAP_SECTION, async ({ driver }) => {
  try {
    await openAllClientsTable(driver);
  } catch {
    // Best-effort — see wave0.mjs.
  }

  const initialElements = await requireSnapshot(driver);
  const rows = matterRows(initialElements);
  if (rows.length === 0) {
    return makeResult({
      id: GAP_ID,
      section: GAP_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No client rows found in All Clients, so no Client Map gap rows can be checked.',
    });
  }

  for (const row of rows) {
    await clickElement(driver, row);
    await openSmokeClientOverview(driver);
    const elements = await requireSnapshot(driver);
    // Deliberately "clientmap-ask-flag" ONLY, never "clientmap-ask-know":
    // confirmed in source (ClientMapPanel.tsx) that "I know this" calls
    // onAnswerQuestion(q), which opens an answer-entry prompt rather than
    // resolving anything — clicking it (even under --live, see the dismiss
    // check below) would hang or leave a stray modal open. "Ask the client"
    // calls flagForClient(), which synchronously calls markGapResolved() with
    // no modal — the only one of the two ever clicked by this harness.
    const resolveButtons = elements.filter((e) => e.testid === 'clientmap-ask-flag');
    if (resolveButtons.length > 0) {
      const gapShot = await driver.captureScreenshot('wave4-estate-beneficiary-gap-row');
      return makeResult({
        id: GAP_ID,
        section: GAP_SECTION,
        status: STATUS.PASS,
        detail: `Client Map gap row rendered after opening ${row.testid} from All Clients. Not dismissed here (read-only default) — see wave4-estate-beneficiary-gap-dismiss-live for the --live dismissal check.`,
        screenshots: [gapShot],
      });
    }
    await openAllClientsTable(driver);
  }

  return makeResult({
    id: GAP_ID,
    section: GAP_SECTION,
    status: STATUS.SETUP_BLOCKED,
    detail: `No clientmap-ask-flag row was found after checking ${rows.length} All Clients row(s). This fixture workspace may not currently contain an unresolved estate/beneficiary gap.`,
  });
});

const GAP_DISMISS_LIVE_ID = 'wave4-estate-beneficiary-gap-dismiss-live';

export const checkEstateBeneficiaryGapDismissLive = withGuard(GAP_DISMISS_LIVE_ID, GAP_SECTION, async ({ driver, live }) => {
  if (!live) {
    return makeResult({
      id: GAP_DISMISS_LIVE_ID,
      section: GAP_SECTION,
      status: STATUS.SKIPPED,
      detail: 'Skipped: requires --live (this run did not pass it). Dismissing a gap here is a real fixture mutation (markGapResolved, audit-logged) — never run against a bench whose demo data other runs still depend on.',
    });
  }

  const elements = await requireSnapshot(driver);
  const resolveButtons = elements.filter((e) => e.testid === 'clientmap-ask-flag');
  if (resolveButtons.length === 0) {
    return makeResult({
      id: GAP_DISMISS_LIVE_ID,
      section: GAP_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No clientmap-ask-flag control found — run wave4-estate-beneficiary-gap first to reach a client with a flagged gap.',
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
      id: GAP_DISMISS_LIVE_ID,
      section: GAP_SECTION,
      status: STATUS.FAIL,
      detail: 'Clicked the resolve control, but the gap row is still present afterward (no "Nothing outstanding" clean state, and the resolvable-row count did not drop).',
      screenshots: [dismissShot],
    });
  }

  return makeResult({
    id: GAP_DISMISS_LIVE_ID,
    section: GAP_SECTION,
    status: STATUS.PASS,
    detail: `Dismissing the gap via the Client Map resolve control cleared it (${
      cleanState ? '"Nothing outstanding" clean state shown' : `resolvable rows dropped from ${resolveButtons.length} to ${remaining}`
    }). (--live)`,
    screenshots: [dismissShot],
  });
});

const ASK_ID = 'wave4-whole-practice-ask';
const ASK_SECTION = 'Wave 4 — Depth (Track C: hidden whole-practice Ask scope)';
const VISIBLE_ASK_SCOPES = [
  { testid: 'scope-option-all-matters', expectedPill: 'All clients' },
  { testid: 'scope-option-email', expectedPill: 'Email' },
  { testid: 'scope-option-documents', expectedPill: 'Documents' },
];

export const checkWholePracticeAsk = withGuard(ASK_ID, ASK_SECTION, async ({ driver }) => {
  try {
    await openAskSurface(driver);
  } catch {
    // Best-effort — see wave0.mjs.
  }

  const elements = await requireSnapshot(driver);
  const hiddenWholePracticePresent = await driver.evalJs(
    '!!document.querySelector(\'[data-testid="scope-option-whole-practice"]\')',
  );
  if (hiddenWholePracticePresent === true || findByTestId(elements, 'scope-option-whole-practice')) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.FAIL,
      detail: 'The hidden whole-practice Ask control still renders ([data-testid="scope-option-whole-practice"]).',
    });
  }

  const missingScopes = VISIBLE_ASK_SCOPES.filter((scope) => !findByTestId(elements, scope.testid));
  if (missingScopes.length === VISIBLE_ASK_SCOPES.length) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No visible Ask scope controls found — not on the Ask surface, or the scope toggle is not present.',
    });
  }
  if (missingScopes.length > 0) {
    return makeResult({
      id: ASK_ID,
      section: ASK_SECTION,
      status: STATUS.FAIL,
      detail: `The whole-practice chip is hidden, but these visible Ask scopes are missing: ${missingScopes.map((scope) => scope.testid).join(', ')}.`,
    });
  }

  for (const scope of VISIBLE_ASK_SCOPES) {
    await driver.click(scope.testid);
    const pillText = await driver.evalJs(
      'document.querySelector(\'[data-testid="ask-scope-pill"]\')?.textContent?.trim() ?? null',
    );
    if (pillText !== scope.expectedPill) {
      return makeResult({
        id: ASK_ID,
        section: ASK_SECTION,
        status: STATUS.FAIL,
        detail: `Clicked [data-testid="${scope.testid}"], but the Ask scope pill read ${JSON.stringify(pillText)} instead of ${JSON.stringify(scope.expectedPill)}.`,
      });
    }
  }

  const scopeShot = await driver.captureScreenshot('wave4-hidden-whole-practice-scope-toggle');

  return makeResult({
    id: ASK_ID,
    section: ASK_SECTION,
    status: STATUS.PASS,
    detail: 'Whole-practice Ask scope option is absent, and All clients, Email, and Documents each switch the Ask scope pill.',
    screenshots: [scopeShot],
  });
});
