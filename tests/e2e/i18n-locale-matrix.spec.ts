/**
 * Locale matrix smoke test (Stream E task 7.1).
 *
 * The Playwright config defines four projects: chromium (default English,
 * preserves existing snapshot baselines), en, es, de. The en/es/de projects
 * navigate to the app with `?lang=...` so src/main.tsx's bootstrapLocale
 * picks up the override and switches i18n before the first paint.
 *
 * This spec is a proof-of-concept: it verifies the workspace selector
 * renders in each locale's expected language. The full suite (every other
 * spec in tests/e2e/) inherits the matrix automatically because
 * baseURL is per-project.
 *
 * To run only this spec across the matrix:
 *   npx playwright test i18n-locale-matrix --project=en --project=es --project=de
 */

import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers/test-utils';

const EXPECTED_HEADING = {
  // The workspace selector card heading. Must match the actual translated
  // string in src/locales/<lng>.json -> workspace.selector.title (or
  // whichever key the dialog uses for its primary heading). Update if the
  // copy moves.
  en: 'workspace',
  es: 'espacio',
  de: 'arbeitsbereich',
} as const;

type Locale = keyof typeof EXPECTED_HEADING;

test.describe('locale matrix smoke', () => {
  test('workspace selector renders in the project locale', async ({ page }, testInfo) => {
    const projectName = testInfo.project.name as Locale | 'chromium';
    if (projectName === 'chromium') test.skip(true, 'matrix-only test');

    await page.goto('/');
    await waitForAppLoad(page);

    // The workspace-selector heading element should contain the locale's
    // expected term. Case-insensitive substring match: tolerates copy
    // tweaks while still catching English bleeding through into es/de.
    const expected = EXPECTED_HEADING[projectName as Locale];
    const heading = page.getByTestId('open-existing-workspace');
    await expect(heading).toBeVisible();
    const text = (await heading.innerText()).toLowerCase();
    expect(text, `expected heading text to contain "${expected}" for ${projectName}, got: ${text}`).toContain(expected);
  });
});
