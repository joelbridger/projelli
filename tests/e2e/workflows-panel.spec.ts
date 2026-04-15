/**
 * Workflows Panel tests (UX-09)
 *
 * The sidebar Workflows panel now:
 *   1. Fills all available sidebar height with a scrollable list region
 *      (previously squeezed to ~131px on short viewports).
 *   2. Exposes a "Open full view" button that launches a Radix Dialog
 *      containing a 3-column grid of all workflows with a search filter.
 *   3. Has a proper <DialogTitle> in the modal (a11y — no UX-02 regression).
 */

import { test, expect } from '@playwright/test';
import {
  waitForTestModeLoad,
  hardClick,
  safeFill,
  openSidebarTab,
} from './helpers/test-utils';

test.describe('Workflows Panel (UX-09)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await openSidebarTab(page, 'workflows');
  });

  test('panel fills available sidebar height', async ({ page }) => {
    const panel = page.getByTestId('workflows-panel');
    await expect(panel).toBeVisible();
    // Before UX-09 the scroll area was capped at ~131px (4% of viewport).
    // With h-full + flex-1 the panel now takes the entire tabpanel slot.
    // On the default Playwright viewport (1280x720) that works out to
    // ~350-650px depending on sidebar header/nav height, so we assert 300+.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(300);
  });

  test('"Open full view" button launches the modal', async ({ page }) => {
    const btn = page.getByTestId('workflows-open-full-view');
    await hardClick(btn);
    const modal = page.getByTestId('workflows-modal');
    await expect(modal).toBeVisible();
  });

  test('modal has a real DialogTitle (a11y)', async ({ page }) => {
    await hardClick(page.getByTestId('workflows-open-full-view'));
    const modal = page.getByTestId('workflows-modal');
    await expect(modal).toBeVisible();
    // Radix Dialog wires the visible DialogTitle as aria-labelledby of
    // DialogContent. Assert the visible heading is present.
    await expect(modal.getByRole('heading', { name: /all workflows/i })).toBeVisible();
  });

  test('modal search filters the grid', async ({ page }) => {
    await hardClick(page.getByTestId('workflows-open-full-view'));
    const search = page.getByTestId('workflows-modal-search');
    await expect(search).toBeVisible();

    // Before filtering: expect at least a handful of cards.
    const allCards = page.locator('[data-testid^="workflow-modal-card-"]');
    const beforeCount = await allCards.count();
    expect(beforeCount).toBeGreaterThan(3);

    // Filter to something unlikely to match any workflow name.
    await safeFill(search, '___nomatchterm___');
    await expect(page.getByTestId('workflows-modal-empty')).toBeVisible();
  });

  test('modal closes with Escape', async ({ page }) => {
    await hardClick(page.getByTestId('workflows-open-full-view'));
    await expect(page.getByTestId('workflows-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workflows-modal')).toHaveCount(0);
  });

  test('sidebar list shows workflow cards with stable testids', async ({ page }) => {
    // Sidebar list cards use `workflow-card-<id>` testids. Grab the first
    // card by prefix match.
    const sidebarCards = page.locator('[data-testid^="workflow-card-"]');
    expect(await sidebarCards.count()).toBeGreaterThan(0);
  });
});
