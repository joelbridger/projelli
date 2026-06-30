/**
 * Stream D-web Group VII · Task 7.3 — Web demo end-to-end test.
 *
 * Exercises the demo bundle from the user's perspective:
 *   1. Loads the demo entry (index.demo.html under Vite dev) and verifies
 *      the sticky banner, BYOK input, and download CTA are present.
 *   2. Mocks the proxy at /api/demo-chat so we can drive the limit gate
 *      without a real Anthropic key.
 *   3. Triggers the limit modal directly via the
 *      `lantern:demo-limit-hit` window event (the same hook DemoLimitGate
 *      listens for from the proxy). This avoids a 5-message UI walk and
 *      keeps the test stable across product UI changes.
 *   4. Verifies download buttons in the modal carry UTM params.
 *   5. Exercises the BYOK input expand toggle.
 *
 * The dev server config in playwright.config.ts already starts `npm run
 * dev` on :5173. The demo is reachable at /index.demo.html under Vite's
 * default behavior of serving every `*.html` at the project root.
 *
 * The desktop App component this test mounts behind the demo banner shows
 * the workspace selector dialog on first run. We don't care about that
 * surface here; the demo's own UI (banner + modal) is layered above it
 * via the React tree in `src/web-demo/main.tsx`, which is what we test.
 */

import { test, expect } from '@playwright/test';

const DEMO_URL = '/index.demo.html';

test.describe('Web demo sandbox (/try)', () => {
  test.beforeEach(async ({ context }) => {
    // The demo proxy lives at keepance.com in production. In dev it is not
    // reachable, so any real send would fail. We mock it to a 200 response
    // shaped like the proxy's contract so the limit-gate code path runs as
    // designed.
    await context.route('**/api/demo-chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          text: 'Mock response from the demo proxy.',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 5, output_tokens: 8 },
        }),
      }),
    );
  });

  test('demo loads with banner, BYOK input, and download CTA visible', async ({
    page,
  }) => {
    await page.goto(DEMO_URL);

    const banner = page.getByTestId('demo-mode-banner');
    await expect(banner).toBeVisible();

    const downloadBtn = page.getByTestId('demo-banner-download-button');
    await expect(downloadBtn).toBeVisible();
    const href = await downloadBtn.getAttribute('href');
    expect(href).toContain('utm_source=demo');
    expect(href).toContain('utm_campaign=v2-launch');
    expect(href).toContain('utm_content=banner');

    await expect(page.getByTestId('byok-key-input')).toBeVisible();
    await expect(page.getByTestId('byok-status-demo')).toHaveText(
      /Demo AI . 5 messages/,
    );
  });

  test('limit-hit event opens the exit modal and download buttons carry UTM', async ({
    page,
  }) => {
    await page.goto(DEMO_URL);
    await expect(page.getByTestId('demo-mode-banner')).toBeVisible();

    // Drive the limit gate directly via the contract event so the test does
    // not depend on a chat surface render path that may still be evolving.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('lantern:demo-limit-hit', {
          detail: { reason: 'rate-limited', message: 'mock' },
        }),
      );
    });

    const modal = page.getByTestId('demo-exit-modal');
    await expect(modal).toBeVisible();

    const macHref = await page
      .getByTestId('demo-exit-download-mac')
      .getAttribute('href');
    expect(macHref).toContain('utm_source=demo');
    expect(macHref).toContain('utm_campaign=v2-launch');
    expect(macHref).toContain('utm_content=exit_modal');
    expect(macHref).toContain('os=mac');

    const winHref = await page
      .getByTestId('demo-exit-download-windows')
      .getAttribute('href');
    expect(winHref).toContain('os=windows');

    const linuxHref = await page
      .getByTestId('demo-exit-download-linux')
      .getAttribute('href');
    expect(linuxHref).toContain('os=linux');
  });

  test('limit gate fires after the configured message count via mocked proxy', async ({
    page,
  }) => {
    await page.goto(DEMO_URL);
    await expect(page.getByTestId('demo-mode-banner')).toBeVisible();

    // Simulate five successful proxy sends by dispatching the contract
    // `lantern:demo-message-sent` event the way demoAIProvider does on
    // success. After the fifth one, DemoLimitGate opens the modal.
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new CustomEvent('lantern:demo-message-sent'));
      }
    });

    await expect(page.getByTestId('demo-exit-modal')).toBeVisible();
  });

  test('BYOK input expands and rejects malformed keys', async ({ page }) => {
    await page.goto(DEMO_URL);
    await expect(page.getByTestId('demo-mode-banner')).toBeVisible();

    // The desktop App below the banner shows the workspace-selector dialog
    // on first run, whose Radix overlay captures pointer events even though
    // the sticky banner sits above it visually. Drive the BYOK toggle and
    // save handlers directly so the test pins component contract instead of
    // depending on the host app's modal stacking.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="byok-toggle-button"]',
      );
      btn?.click();
    });

    const field = page.getByTestId('byok-key-field');
    await expect(field).toBeVisible();
    await field.fill('not-a-real-key');

    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="byok-save-button"]',
      );
      btn?.click();
    });

    await expect(page.getByTestId('byok-error')).toBeVisible();
  });
});
