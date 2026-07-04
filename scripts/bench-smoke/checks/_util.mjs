// scripts/bench-smoke/checks/_util.mjs — shared guard so every check is
// honest about failure: a bench/connection problem (DriverError) is
// SETUP-BLOCKED, not FAIL — only a real UI assertion mismatch is FAIL. An
// uncaught bug in the check itself still gets reported (FAIL) rather than
// crashing the whole run, since one bad check must not prevent the rest of
// the checklist from reporting.
import { makeResult, STATUS } from '../result.mjs';
import { DriverError } from '../driver.mjs';
import { findByTestId, findByText } from '../parse.mjs';

export function withGuard(id, section, fn) {
  return async (ctx) => {
    const startedAt = Date.now();
    try {
      const result = await fn(ctx);
      return { ...result, durationMs: result.durationMs ?? Date.now() - startedAt };
    } catch (err) {
      const isDriverIssue = err instanceof DriverError;
      return makeResult({
        id,
        section,
        status: isDriverIssue ? STATUS.SETUP_BLOCKED : STATUS.FAIL,
        detail: isDriverIssue
          ? `Bench/driver problem, precondition not verifiable this run: ${err.message}`
          : `Unexpected error in check logic: ${err.stack || err.message}`,
        durationMs: Date.now() - startedAt,
      });
    }
  };
}

/** Snapshot the page and require it to have parsed cleanly; returns the
 * elements array or throws DriverError (caught by withGuard -> SETUP-BLOCKED). */
export async function requireSnapshot(driver) {
  const snap = await driver.snapshot();
  if (!snap.ok) throw new DriverError(`could not read the app's UI: ${snap.error}`);
  return snap.elements;
}

export { findByTestId, findByText };

/**
 * Check for plain informational text (captions, labels, banners) ANYWHERE on
 * the rendered page. Deliberately NOT findByText(snapshot(), ...): confirmed
 * live that desktop-drive.mjs's snapshot() only captures interactive elements
 * ([data-testid], button, a, [role="button"], input, textarea) — a caption
 * like "3 details are cited from your notes" sits in a plain <p>/<span> and
 * never appears in that list, so findByText on a snapshot false-negatives on
 * exactly the kind of confirmation text these checks look for. driver.waitFor
 * is built on Playwright's getByText, which searches the whole rendered DOM
 * (case-insensitive substring) regardless of tag — reuse it here for a
 * short, non-blocking presence check instead of a new capability.
 */
export async function textPresent(driver, text, seconds = 5) {
  const result = await driver.waitFor(text, seconds);
  return result.found;
}

/**
 * Click a snapshot()-matched element correctly regardless of how it was
 * found: by its real data-testid when present (desktop-drive.mjs's own
 * `click` command), or by its visible text when it isn't (driver.clickByText).
 * A prior version of these checks did `driver.click(el.testid ?? undefined)`,
 * which silently sent the literal string "undefined" as a testid whenever an
 * element matched only by text — every such click would time out looking for
 * `[data-testid="undefined"]`. Route through this helper instead of calling
 * driver.click directly with a possibly-missing testid.
 */
export async function clickElement(driver, element) {
  if (!element) throw new DriverError('clickElement: no element to click');
  if (element.testid) return driver.click(element.testid);
  if (element.text) return driver.clickByText(element.text);
  throw new DriverError('clickElement: matched element has neither a testid nor visible text to click by');
}

/**
 * Navigate into the known smoke-test client's Documents view (confirmed live:
 * clicking the per-row `matter-launch-documents-<matterId>` quick action from
 * the Clients/Client-Map list enters that client's "hub" — Client Map /
 * Documents / Email / Activity sub-tabs). Idempotent: if already on that
 * client's Documents (or the button simply isn't present because we're
 * already past the Clients list), the click may no-op or fail — callers
 * treat a thrown DriverError as SETUP-BLOCKED (bench state doesn't allow
 * getting there this run), not a hard failure.
 */
export async function openSmokeClientDocuments(driver, { matterId, waitForText = 'Documents' } = {}) {
  await driver.click(`matter-launch-documents-${matterId}`);
  const wait = await driver.waitFor(waitForText, 10);
  if (!wait.found) {
    throw new DriverError(`clicked into the client's Documents view but "${waitForText}" never appeared: ${wait.error}`);
  }
}

/** From inside a client's hub (see openSmokeClientDocuments), switch to the
 * "Client Map" sub-tab (`hub-subtab-overview`) — where RUN-LOG.md's
 * per-client cited facts render. */
export async function openSmokeClientOverview(driver) {
  await driver.click('hub-subtab-overview');
}

/** From inside a client's hub, switch to the "Documents" sub-tab
 * (`hub-subtab-documents`) — sibling control to hub-subtab-overview.
 * Confirmed in source (MatterHub.tsx): once any hub is open, its sub-tab bar
 * (hub-subtab-overview / hub-subtab-documents / ...) is always present and
 * switchable regardless of which sub-tab is currently showing — there is no
 * "back to the client table" control once a hub is open, so this is the
 * reliable way to force a specific sub-tab without depending on how the hub
 * got opened. */
export async function openSmokeClientDocumentsSubtab(driver) {
  await driver.click('hub-subtab-documents');
}

/**
 * Navigate to the Client Map surface, then switch its "Clients | Whole book"
 * segmented toggle (src/features/matters/MattersHome.tsx, src/ui/kp/
 * SegmentedToggle.tsx) to "Whole book" — that toggle has no per-option
 * data-testid (only visible text), so this goes through clickByText rather
 * than a testid click.
 *
 * If a client hub is already open (from an earlier check — e.g. Wave 0/Wave 2
 * open a docx note), clicking the "matters" spine tab still lands on the
 * table/book view, not the hub: confirmed in source, src/App.tsx's
 * `<AppShellNav onTabChange>` handler unconditionally nulls the store's
 * `clientMapHubId` whenever `tab === 'matters'`, before switching tabs — the
 * same effect as the hub's own (otherwise unwired, see MatterHub.tsx)
 * "<- Clients" back action. One extra defensive click covers the case where
 * the first click's re-render hadn't settled yet.
 */
export async function openWholeBookView(driver) {
  await driver.click('spine-nav-matters');
  const stillInHub = await driver.evalJs('!!document.querySelector(\'[data-testid="hub-subtab-bar"]\')');
  if (stillInHub === true) {
    await driver.click('spine-nav-matters');
  }
  await driver.clickByText('Whole book');
}

/** Navigate to the Ask surface (spine's internal id for it is kept as
 * "search" — see src/app/shell/layout/Spine.tsx's comment on SpineTab ids). */
export async function openAskSurface(driver) {
  await driver.click('spine-nav-search');
}

/** Double-click a file-tree row by its visible filename to open it as a docx
 * editor tab — confirmed live that file rows have no data-testid/button/role
 * and open on double-click, not a single click (see click-by-text.mjs).
 *
 * Switches to "Tree" view first (best-effort, non-fatal): the Documents
 * panel's Tree/Grid view-mode choice persists across navigation, and Grid
 * view only shows the CURRENT folder's contents — if a prior session/check
 * left it on Grid sitting at a client's root folder, the smoke note (which
 * lives in a "Planning" subfolder) is invisible to a whole-page text search
 * and this throws even though the file genuinely exists and opens fine.
 * Tree view, by contrast, renders the fully-expanded hierarchy, so the
 * filename is always findable regardless of prior UI state. Confirmed live
 * during the 2026-07-04 bench-full pass (manual Grid-view testing during
 * that same session had left the workspace on Grid, which silently broke
 * this helper for every check that runs after it).
 */
export async function openSmokeClientNote(driver, { fileName, waitForText = 'Draft follow-up' } = {}) {
  try {
    await driver.clickByText('Tree');
    // Switching view modes re-renders the panel (folders re-expand); give
    // the filename a moment to actually land in the DOM before searching
    // for it — confirmed live that searching immediately after the Tree
    // click can race the re-render and miss a real, about-to-appear row.
    await driver.waitFor(fileName, 5);
  } catch {
    // Ignored — not on a view with a Tree/Grid toggle, already on Tree, or
    // the file just wasn't there yet; doubleClickByText below is the real
    // gate either way.
  }
  await driver.doubleClickByText(fileName);
  const wait = await driver.waitFor(waitForText, 10);
  if (!wait.found) {
    throw new DriverError(`double-clicked "${fileName}" but the docx editor toolbar never appeared: ${wait.error}`);
  }
}

/**
 * Navigate into Settings > AI & Privacy (`settings-gear` spine button ->
 * `settings-category-ai-privacy` rail entry — src/app/shell/layout/
 * SettingsGearButton.tsx, src/features/settings/.../SettingsContent.tsx).
 * That view's first sub-tab is the confidentiality-mode picker by default, no
 * extra click needed. Like openSmokeClientDocuments's siblings, each click
 * uses desktop-drive.mjs's own click-command timeout/failure as the gate — no
 * extra waitFor here; callers treat a thrown DriverError as "couldn't get
 * there this run," same pattern as every other nav helper in this file.
 */
export async function openSettingsAiPrivacy(driver) {
  await driver.click('settings-gear');
  await driver.click('settings-category-ai-privacy');
}

/**
 * Navigate into Account > Connections (`account-identity` spine button opens
 * the Account window, then its `account-tab-connections` tab renders the
 * Calendar/Wealthbox connector cards — src/app/shell/layout/AccountIdentity.tsx,
 * src/platform/connectors/calendar/CalendarConnect.tsx). A DIFFERENT window
 * from Settings, not a sub-view of it — do not conflate with
 * openSettingsAiPrivacy above.
 */
export async function openAccountConnectionsTab(driver) {
  await driver.click('account-identity');
  await driver.click('account-tab-connections');
}
