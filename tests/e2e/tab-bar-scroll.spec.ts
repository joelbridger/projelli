/**
 * Documents Rail Vertical Scroll E2E Tests
 *
 * The Documents surface owns the visible tab rail. It scrolls vertically when
 * many documents are open, keeps the pinned All files entry first, and scrolls the
 * active document into view.
 *
 * The global document tabs beyond the pinned "All files" chip only render on the
 * standalone (non-embedded) Documents/editor surface — DocumentsHome.tsx
 * deliberately hides them in the per-client embedded tab (matter isolation:
 * "a foreign client's open file could appear here" otherwise). gotoDocuments()
 * always lands on that embedded surface, so it never overflows regardless of
 * tab count — use switchToStandaloneEditorSurface instead.
 */

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

async function openSyntheticTab(
  page: import('@playwright/test').Page,
  n: number
): Promise<{ path: string; testId: string }> {
  const name = `file-with-a-moderately-long-name-${String(n).padStart(2, '0')}.md`;
  const path = `/test-workspace/${name}`;
  await page.evaluate((i) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) throw new Error('testMode helper missing');
    const name = `file-with-a-moderately-long-name-${String(i).padStart(2, '0')}.md`;
    const path = `/test-workspace/${name}`;
    fn(path, name, `# Tab ${i}\n\nSome content.`);
  }, n);
  return {
    path,
    testId: `documents-tab-${path.replace(/[^a-zA-Z0-9_-]+/g, '-')}`,
  };
}

test.describe('Documents rail vertical scroll', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true&seedDemo=1');
    await waitForTestModeLoad(page);
    // Pin a shorter viewport so the vertical rail reliably overflows.
    await page.setViewportSize({ width: 1000, height: 520 });
    await switchToStandaloneEditorSurface(page);
  });

  test('opening many tabs overflows vertically and scrolls the active tab into view', async ({ page }) => {
    // Open enough document tabs to exceed the rail height.
    for (let i = 0; i < 18; i++) {
      await openSyntheticTab(page, i);
    }

    const strip = page.getByTestId('documents-tab-strip');
    const railScroller = strip.locator('[data-testid="tab-bar-scroll"]');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('aria-orientation', 'vertical');
    await expect(page.getByTestId('documents-files-tab')).toBeVisible();

    const firstTabText = await strip
      .locator('[role="tab"]')
      .first()
      .evaluate((el) => el.textContent ?? '');
    expect(firstTabText).toContain('All files');

    // The rail should now overflow vertically, not rely on horizontal buttons.
    const overflow = await railScroller.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      overflowY: getComputedStyle(el).overflowY,
      overflowX: getComputedStyle(el).overflowX,
    }));
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
    expect(overflow.overflowY).toBe('auto');
    expect(overflow.overflowX).toBe('hidden');
    await expect(page.getByTestId('tab-bar-scroll-left')).toHaveCount(0);
    await expect(page.getByTestId('tab-bar-scroll-right')).toHaveCount(0);

    await railScroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    const before = await railScroller.evaluate((el) => el.scrollTop);
    await railScroller.evaluate((el) => {
      el.scrollBy({ top: 160, behavior: 'auto' });
    });
    await expect
      .poll(async () => railScroller.evaluate((el) => el.scrollTop), { timeout: 2_000 })
      .toBeGreaterThan(before);

    // Simulate opening a new document while the rail is scrolled back to the
    // top. The active tab should be brought into the visible rail area.
    await railScroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    const activeTab = await openSyntheticTab(page, 99);

    await expect
      .poll(async () => railScroller.evaluate((el) => el.scrollTop), { timeout: 2_000 })
      .toBeGreaterThan(0);

    const activePlacement = await railScroller.evaluate((el, testId) => {
      const tab = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!tab) return null;
      const railRect = el.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      return {
        tabTop: tabRect.top,
        tabBottom: tabRect.bottom,
        railTop: railRect.top,
        railBottom: railRect.bottom,
      };
    }, activeTab.testId);

    expect(activePlacement).not.toBeNull();
    expect(activePlacement!.tabTop).toBeGreaterThanOrEqual(activePlacement!.railTop - 1);
    expect(activePlacement!.tabBottom).toBeLessThanOrEqual(activePlacement!.railBottom + 1);
  });
});
