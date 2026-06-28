/**
 * Tab Bar Horizontal Scroll E2E Tests (Phase 7)
 *
 * The redesigned Documents surface owns the visible tab strip. It scrolls
 * horizontally instead of wrapping onto a second row.
 */

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad, gotoDocuments } from './helpers/test-utils';

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
    await page.goto('/?testMode=true&seedDemo=1');
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

    await gotoDocuments(page);
    const strip = page.getByTestId('documents-tab-strip');
    await expect(strip).toBeVisible();

    // The strip should now overflow horizontally.
    const overflow = await strip.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

    const before = await strip.evaluate((el) => el.scrollLeft);
    await strip.evaluate((el) => {
      el.scrollBy({ left: 240, behavior: 'auto' });
    });
    await expect
      .poll(async () => strip.evaluate((el) => el.scrollLeft), { timeout: 2_000 })
      .toBeGreaterThan(before);
  });
});
