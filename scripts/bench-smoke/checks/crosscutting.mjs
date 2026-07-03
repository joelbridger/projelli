// scripts/bench-smoke/checks/crosscutting.mjs — Cross-cutting checks from
// RUN-LOG.md: light theme, console-error cleanliness, egress indicator.
import { STATUS, makeResult } from '../result.mjs';
import { withGuard, requireSnapshot, findByText } from './_util.mjs';

const SECTION = 'Cross-cutting';

export const checkLightTheme = withGuard('cross-cutting-light-theme', SECTION, async ({ driver }) => {
  const isLight = await driver.evalJs(
    "(() => { const c = document.documentElement.classList; return !c.contains('dark') && (document.documentElement.getAttribute('data-theme') !== 'dark'); })()"
  );
  if (isLight !== true) {
    return makeResult({
      id: 'cross-cutting-light-theme',
      section: SECTION,
      status: STATUS.FAIL,
      detail: `Expected the light theme (Jameson dislikes dark mode); document root indicates dark. Raw eval result: ${JSON.stringify(isLight)}`,
    });
  }
  return makeResult({
    id: 'cross-cutting-light-theme',
    section: SECTION,
    status: STATUS.PASS,
    detail: 'Document root has no dark-theme class/attribute.',
  });
});

export const checkConsoleErrors = withGuard('cross-cutting-console-errors', SECTION, async ({ driver }) => {
  await driver.installConsoleWatch();
  // Touch a couple of surfaces so navigation-triggered errors have a chance to
  // fire, mirroring RUN-LOG's "navigating between Client Map / Documents /
  // Settings" spot check — best-effort text waits, not hard requirements.
  await driver.waitFor('Client Map', 5).catch(() => {});
  await driver.waitFor('Documents', 5).catch(() => {});

  const { clean, errors, note } = await driver.readConsoleErrors();
  if (clean === null) {
    return makeResult({
      id: 'cross-cutting-console-errors',
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: `Console watch did not report data: ${note}`,
    });
  }
  if (!clean) {
    return makeResult({
      id: 'cross-cutting-console-errors',
      section: SECTION,
      status: STATUS.FAIL,
      detail: `${errors.length} console error(s)/unhandled rejection(s) captured: ${errors.slice(0, 5).join(' | ')}`,
    });
  }
  return makeResult({
    id: 'cross-cutting-console-errors',
    section: SECTION,
    status: STATUS.PASS,
    detail: 'No console errors, window.onerror, or unhandledrejection events captured during navigation.',
  });
});

export const checkEgressIndicator = withGuard('cross-cutting-egress-indicator', SECTION, async ({ driver }) => {
  const elements = await requireSnapshot(driver);
  const localOnlyToggle = findByText(elements, /on this computer only/i);
  if (!localOnlyToggle) {
    return makeResult({
      id: 'cross-cutting-egress-indicator',
      section: SECTION,
      status: STATUS.SETUP_BLOCKED,
      detail: 'No "On this computer only" confidentiality toggle found — not on the Settings > AI & Privacy view.',
    });
  }

  await driver.click(localOnlyToggle.testid ?? undefined);
  const isolated = await driver.waitFor('outside connections are blocked', 10);
  const shot = await driver.captureScreenshot('cross-cutting-egress-local-only');

  // Always try to revert to the recommended default, even if the assertion
  // above failed, so the bench isn't left in Local-only for the next check.
  const cloudToggle = findByText(await requireSnapshot(driver), /cloud ai.*your account/i);
  if (cloudToggle) await driver.click(cloudToggle.testid ?? undefined).catch(() => {});

  if (!isolated.found) {
    return makeResult({
      id: 'cross-cutting-egress-indicator',
      section: SECTION,
      status: STATUS.FAIL,
      detail: 'Switched to Local-only but the egress indicator never showed the "outside connections are blocked" message.',
      screenshots: [shot],
    });
  }

  return makeResult({
    id: 'cross-cutting-egress-indicator',
    section: SECTION,
    status: STATUS.PASS,
    detail: 'Local-only mode correctly flips the egress indicator; reverted to Cloud AI (recommended default) afterward.',
    screenshots: [shot],
  });
});
