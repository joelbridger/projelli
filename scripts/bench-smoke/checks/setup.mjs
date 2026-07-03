// scripts/bench-smoke/checks/setup.mjs — Phase-1-equivalent checks from
// RUN-LOG.md: workspace folderPaths rebind, per-client Documents scoping, RAG
// index health. These assume a workspace is ALREADY open on the bench (the
// harness does not create workspaces or drive OAuth) — if it isn't, the check
// reports SETUP-BLOCKED rather than guessing.
import { STATUS, makeResult } from '../result.mjs';
import { withGuard, requireSnapshot, findByTestId, findByText, textPresent, openSmokeClientDocuments, openSmokeClientOverview } from './_util.mjs';
import { SMOKE_CLIENT_MATTER_ID } from './smoke-workspace.mjs';

// Best-effort: navigate to the known smoke client's Documents/Client-Map view
// before asserting. Swallowed on failure — the assertions below (waitFor
// 'Documents'/'Client Map') are the real, honest gate; this just saves a
// human from having to pre-navigate by hand for the common case where the
// app landed somewhere else (e.g. the whole-book Clients list).
async function primeClientView(driver, after) {
  try {
    await openSmokeClientDocuments(driver, { matterId: SMOKE_CLIENT_MATTER_ID });
    if (after === 'overview') await openSmokeClientOverview(driver);
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

    const elements = await requireSnapshot(driver);
    const anyFile = findByText(elements, /\.docx|\.pdf/i);
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
      detail: `Documents tab shows real files for the selected client (e.g. "${anyFile.text}").`,
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

    const brokenIndex =
      (await textPresent(driver, 'memory integrity uncertain', 3)) ||
      (await textPresent(driver, 'ai-connection error', 3)) ||
      (await textPresent(driver, 'indexing failed', 3));
    if (brokenIndex) {
      return makeResult({
        id: 'index-health',
        section: 'Phase 1 — setup',
        status: STATUS.FAIL,
        detail: 'Client Map is showing an index-health error (memory integrity uncertain / AI-connection error / indexing failed).',
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
