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
