/**
 * Tab Bar Horizontal Scroll E2E Tests (Phase 7)
 *
 * The tab strip now scrolls horizontally instead of wrapping onto a second
 * row. Verifies that:
 *   - Opening enough tabs triggers overflow (scrollWidth > clientWidth)
 *   - The scroll-right button appears when there's content to the right
 *   - Clicking the scroll-right button advances the strip
 */

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad } from './helpers/test-utils';

async function openSyntheticTab(
  page: import('@playwright/test').Page,
  n: number
) {
  await page.evaluate((i) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) throw new Error('testMode helper missing');
    // Long names with distinctive prefixes so each tab takes its full
    // min-width (120px) and we overflow faster.
    const name = `file-with-a-moderately-long-name-${i}.md`;
    const path = `/test-workspace/${name}`;
    fn(path, name, `# Tab ${i}\n\nSome content.`);
  }, n);
}

test.describe('Tab Bar Horizontal Scroll', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Pin a known viewport size so the min-width per tab reliably overflows.
    await page.setViewportSize({ width: 1000, height: 800 });
  });

  test('opening many tabs overflows horizontally and shows scroll buttons', async ({ page }) => {
    // Open 10 tabs in sequence. Each tab is at least 120px wide, so 10 tabs
    // should push total width past 1000px viewport minus sidebar width.
    for (let i = 0; i < 10; i++) {
      await openSyntheticTab(page, i);
    }

    const strip = page.getByTestId('tab-bar-scroll');
    await expect(strip).toBeVisible();

    // The strip should now overflow horizontally.
    const overflow = await strip.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

    // The "scroll right" button should be visible when we can still scroll
    // further right. Since the most recently opened tab is active and
    // scrolled into view, we expect to be near the RIGHT edge, meaning the
    // LEFT button should be visible.
    await expect(page.getByTestId('tab-bar-scroll-left')).toBeVisible();

    // Clicking the left scroll button should change scrollLeft.
    const leftButton = page.getByTestId('tab-bar-scroll-left');
    const before = await strip.evaluate((el) => el.scrollLeft);
    await leftButton.click();
    await expect
      .poll(async () => strip.evaluate((el) => el.scrollLeft), { timeout: 2_000 })
      .toBeLessThan(before);

    // And the right scroll button should now be visible (there's content to
    // the right of our current position). Wait for scroll state to settle
    // — smooth scroll + ResizeObserver need a frame or two to propagate.
    await expect(page.getByTestId('tab-bar-scroll-right')).toBeVisible({ timeout: 5_000 });
  });
});
