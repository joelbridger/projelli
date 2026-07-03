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

/** Double-click a file-tree row by its visible filename to open it as a docx
 * editor tab — confirmed live that file rows have no data-testid/button/role
 * and open on double-click, not a single click (see click-by-text.mjs). */
export async function openSmokeClientNote(driver, { fileName, waitForText = 'Draft follow-up' } = {}) {
  await driver.doubleClickByText(fileName);
  const wait = await driver.waitFor(waitForText, 10);
  if (!wait.found) {
    throw new DriverError(`double-clicked "${fileName}" but the docx editor toolbar never appeared: ${wait.error}`);
  }
}
