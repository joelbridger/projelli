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
