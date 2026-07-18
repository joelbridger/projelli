/**
 * Real-browser regression for the tab guard's startup lifecycle. This does
 * not use waitForAppLoad: a readiness-helper change must never hide a second
 * top-level navigation caused by a browser-guard reload loop.
 */
import { test, expect } from '@playwright/test';

test.describe('browser tab guard startup', () => {
  test('ordinary browser startup renders once without a reload', async ({ page }) => {
    let topLevelDocumentRequests = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        topLevelDocumentRequests += 1;
      }
    });

    await page.goto('/', { waitUntil: 'load' });

    // Start observing only after the initial document has loaded. Any next
    // main-frame navigation inside this bounded window is a reload regression.
    const secondNavigation = page
      .waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 1_500,
      })
      .then(() => true)
      .catch(() => false);

    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('open-existing-workspace')).toBeVisible();
    expect(await secondNavigation).toBe(false);
    expect(topLevelDocumentRequests).toBe(1);
  });
});
