// scripts/bench-smoke/checks/setup.mjs — Phase-1-equivalent checks from
// RUN-LOG.md: workspace folderPaths rebind, per-client Documents scoping, RAG
// index health. These assume a workspace is ALREADY open on the bench (the
// harness does not create workspaces or drive OAuth) — if it isn't, the check
// reports SETUP-BLOCKED rather than guessing.
import { STATUS, makeResult } from '../result.mjs';
import {
  withGuard,
  requireSnapshot,
  findByTestId,
  findByText,
  textPresent,
  openSmokeClientDocuments,
  openSmokeClientOverview,
  openSmokeClientDocumentsSubtab,
} from './_util.mjs';
import { SMOKE_CLIENT_MATTER_ID } from './smoke-workspace.mjs';

// Best-effort: navigate to the known smoke client's Documents/Client-Map view
// before asserting. The two steps are tried INDEPENDENTLY (not one try/catch
// around both) — this is a deliberate fix for documented flakiness in
// index-health (see docs/qa/BENCH-SMOKE-HARNESS.md "Known follow-ups").
// Root cause, confirmed in the app source (MatterHub.tsx): once ANY client
// hub is open, there is no UI control wired back to the client table
// (closeHub() is never bound to a visible button), so
// matter-launch-documents-<matterId> can legitimately disappear the instant
// a prior check (e.g. Wave 0/Wave 2, which open a docx note) leaves a hub
// open on a different sub-tab — but the hub's own sub-tab bar
// (hub-subtab-overview / hub-subtab-documents) is a persistent sibling
// control that stays present and switchable regardless. A single try/catch
// wrapping both steps meant that whenever step 1 failed for this reason,
// step 2 (switching to the actually-desired sub-tab) never even ran — this
// check would then assert against whatever sub-tab a PRIOR check happened to
// leave open, which is exactly the "ordering/timing interaction" flakiness
// this harness saw live (SETUP-BLOCKED some runs, PASS others). Splitting the
// steps means the sub-tab switch always runs, whether the hub was already
// open or was just opened by step 1. The assertions below (waitFor
// 'Documents'/'Client Map') remain the real, honest gate either way.
async function primeClientView(driver, after) {
  try {
    await openSmokeClientDocuments(driver, { matterId: SMOKE_CLIENT_MATTER_ID });
  } catch {
    // Ignored — see comment above.
  }
  try {
    if (after === 'overview') await openSmokeClientOverview(driver);
    else await openSmokeClientDocumentsSubtab(driver);
  } catch {
    // Ignored — see comment above.
  }
}

export const checkWorkspaceBinding = withGuard(
  'workspace-binding',
  'Phase 1 — setup',
  async ({ driver }) => {
    const elements = await requireSnapshot(driver);
    const clientsEntry = findByTestId(elements, 'spine-new-client') || findByText(elements, /clients/i);
    if (!clientsEntry) {
      return makeResult({
        id: 'workspace-binding',
        section: 'Phase 1 — setup',
        status: STATUS.SETUP_BLOCKED,
        detail: 'No "Clients" management entry point found in the current view — is a workspace open on this bench?',
      });
    }

    const shot = await driver.captureScreenshot('workspace-binding-clients-entry');
    return makeResult({
      id: 'workspace-binding',
      section: 'Phase 1 — setup',
      status: STATUS.PASS,
      detail: 'Clients management entry point is present, implying the workspace is bound and its client list rendered.',
      screenshots: [shot],
    });
  }
);

export const checkPerClientFilesVisible = withGuard(
  'per-client-files-visible',
  'Phase 1 — setup',
  async ({ driver }) => {
    await primeClientView(driver);
    const wait = await driver.waitFor('Documents', 10);
    if (!wait.found) {
      return makeResult({
        id: 'per-client-files-visible',
        section: 'Phase 1 — setup',
        status: STATUS.SETUP_BLOCKED,
        detail: `No "Documents" tab/label appeared within 10s — no client selected, or the app isn't on a client-scoped view yet: ${wait.error}`,
      });
    }

    // NOT findByText(requireSnapshot(driver), ...): snapshot() only captures
    // interactive elements ([data-testid], button, a, [role="button"], input,
    // textarea) — confirmed live that file rows in the Documents list are
    // plain text nodes, so this always false-negatived via the snapshot path
    // (root-caused during the 2026-07-04 bench-full pass: manually clicking
    // into Documents showed real files while this check still reported
    // SETUP-BLOCKED). textPresent/driver.waitFor searches the real rendered
    // page text instead, same pattern already used for the same reason in
    // index-health just below.
    const anyFile = (await textPresent(driver, '.docx', 10)) ? '.docx' : (await textPresent(driver, '.pdf', 3)) ? '.pdf' : null;
    if (!anyFile) {
      return makeResult({
        id: 'per-client-files-visible',
        section: 'Phase 1 — setup',
        status: STATUS.SETUP_BLOCKED,
        detail: 'Documents tab is present but no file rows (.docx/.pdf) are visible — the selected client may have no real folder mapped.',
      });
    }

    const shot = await driver.captureScreenshot('per-client-files-visible-docs-tab');
    return makeResult({
      id: 'per-client-files-visible',
      section: 'Phase 1 — setup',
      status: STATUS.PASS,
      detail: `Documents tab shows real files for the selected client (found "${anyFile}" text).`,
      screenshots: [shot],
    });
  }
);

export const checkIndexHealth = withGuard(
  'index-health',
  'Phase 1 — setup',
  async ({ driver }) => {
    await primeClientView(driver, 'overview');
    const wait = await driver.waitFor('Client Map', 10);
    if (!wait.found) {
      return makeResult({
        id: 'index-health',
        section: 'Phase 1 — setup',
        status: STATUS.SETUP_BLOCKED,
        detail: `No "Client Map" surface appeared within 10s: ${wait.error}`,
      });
    }

    // Text pulled directly from src/features/matters/clientMap/
    // errorClassification.ts (merged into lantern-plus after this check was
    // first written — the classifier now distinguishes an index/retrieval
    // failure from a provider failure instead of always blaming "your AI
    // connection"). "needs to rebuild" is the index-specific build/update
    // message; "Could not build client map" / "Could not check for client
    // map updates" cover the provider/unknown buckets, which still indicate
    // a real Client Map failure even though they're not index-specific.
    const brokenIndex =
      (await textPresent(driver, 'needs to rebuild', 3)) ||
      (await textPresent(driver, 'Could not build client map', 3)) ||
      (await textPresent(driver, 'Could not check for client map updates', 3));
    if (brokenIndex) {
      return makeResult({
        id: 'index-health',
        section: 'Phase 1 — setup',
        status: STATUS.FAIL,
        detail: 'Client Map is showing a build/update error ("needs to rebuild" / "Could not build client map" / "Could not check for client map updates").',
      });
    }

    const citedFact = await textPresent(driver, 'cited');
    if (!citedFact) {
      return makeResult({
        id: 'index-health',
        section: 'Phase 1 — setup',
        status: STATUS.SETUP_BLOCKED,
        detail: 'Client Map rendered with no error, but no cited-fact text was found either — inconclusive without a known client selected.',
      });
    }

    const shot = await driver.captureScreenshot('index-health-client-map');
    return makeResult({
      id: 'index-health',
      section: 'Phase 1 — setup',
      status: STATUS.PASS,
      detail: 'Client Map shows cited facts with no index-health error text present.',
      screenshots: [shot],
    });
  }
);
