/**
 * Spreadsheet Polish / Phase 7 E2E Tests
 *
 * Covers the improvements layered on top of the Phase 1–3 viewer:
 *   - Live formula engine recomputes dependent cells on edit
 *   - Formula bar shows the selected cell's formula
 *   - Selection summary shows numeric value
 *   - Column resize handle drags column width
 *   - Cell tooltip surfaces full text on truncated cells
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
} as const;

function readFixtureAsDataUrl(name: string, mime: string): string {
  const bytes = readFileSync(join(fixturesDir, name));
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}

async function openFixtureTab(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  await page.evaluate((a) => {
    const fn = (window as unknown as {
      __openTestFile?: (p: string, n: string, c: string) => void;
    }).__openTestFile;
    if (!fn) {
      throw new Error('window.__openTestFile is not defined — is testMode=true?');
    }
    fn(a.path, a.name, a.content);
  }, args);
}

test.describe('Spreadsheet Improvements (Phase 7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('formula engine recomputes C3 when B3 is edited', async ({ page }) => {
    // Fixture: B3=10000, C3 is =B3*1.1 -> 11000. Edit B3 to 20000 and
    // expect C3 to recompute to 22000 without a file reload.
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/formulas-live.xlsx',
      name: 'formulas-live.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Sanity: C3 starts at 11000 (the engine seeded from SheetJS's cached
    // value — so even before any edit, it should match the formula output).
    const c3 = page.getByTestId('spreadsheet-cell-2-2');
    await expect(c3).toContainText('11000');

    // Edit B3 (cell-2-1): 10000 -> 20000
    const b3 = page.getByTestId('spreadsheet-cell-2-1');
    await b3.dblclick();
    const input = page.getByTestId('spreadsheet-cell-input-2-1');
    await expect(input).toBeVisible();
    await input.fill('20000');
    await input.press('Enter');

    // C3 should now show 22000 (20000 * 1.1)
    await expect(c3).toContainText('22000', { timeout: 5_000 });
  });

  test('UX-18: formula bar shows selection-driven content in editable mode', async ({ page }) => {
    // Note: in editable mode the bar stays expanded at all times so the
    // dblclick-to-edit flow never suffers a layout shift. The collapse
    // behaviour still applies in read-only viewers (covered separately).
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/ux18.xlsx',
      name: 'ux18.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    const formulaBar = page.getByTestId('spreadsheet-formula-bar');
    const summary = page.getByTestId('spreadsheet-selection-summary');

    // Editable mode: data-state stays "expanded" even before selection.
    await expect(formulaBar).toHaveAttribute('data-state', 'expanded');
    await expect(summary).toHaveAttribute('data-state', 'expanded');

    // Before selection the reference box is empty (rendered as a
    // non-breaking space) — the bar frame is visible but holds no content.
    const ref = page.getByTestId('spreadsheet-formula-bar-ref');
    const initialRef = await ref.textContent();
    expect(initialRef?.trim()).toBe('');

    // Clicking a cell populates the reference box and keeps data-state expanded.
    await page.getByTestId('spreadsheet-cell-1-0').click();
    await expect(formulaBar).toHaveAttribute('data-state', 'expanded');
    await expect(ref).not.toHaveText('');
  });

  test('formula bar shows the selected cell formula', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/formula-bar.xlsx',
      name: 'formula-bar.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Click C3 — a formula cell. Formula bar should display =B3*1.1.
    await page.getByTestId('spreadsheet-cell-2-2').click();
    await expect(page.getByTestId('spreadsheet-formula-bar')).toBeVisible();
    await expect(page.getByTestId('spreadsheet-formula-bar-ref')).toHaveText('C3');
    await expect(page.getByTestId('spreadsheet-formula-bar-content')).toHaveText('=B3*1.1');
  });

  test('selection summary shows value for numeric cell', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/summary.xlsx',
      name: 'summary.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // B3 = 10000
    await page.getByTestId('spreadsheet-cell-2-1').click();
    await expect(page.getByTestId('spreadsheet-selection-summary')).toContainText(
      'Value: 10000'
    );
  });

  test('selection summary hides value for non-numeric cell', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/summary-nonum.xlsx',
      name: 'summary-nonum.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // A3 = "Jan" — not numeric
    await page.getByTestId('spreadsheet-cell-2-0').click();
    const summary = page.getByTestId('spreadsheet-selection-summary');
    await expect(summary).toBeVisible();
    // Should NOT contain "Value:" when not numeric
    await expect(summary).not.toContainText('Value:');
  });

  test('dragging the column B resize handle widens column B', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/resize.xlsx',
      name: 'resize.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Read the current width of column B's header (which matches the
    // width of every B-column cell below it).
    const headerB = page.getByTestId('spreadsheet-column-header-B');
    const initialBox = await headerB.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Drag the resize handle 50px to the right.
    const handle = page.getByTestId('spreadsheet-column-resize-B');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 50, startY, { steps: 10 });
    await page.mouse.up();

    // Column should have widened. The mouse delta is 50px so the width
    // should be ~50px bigger (allow for rounding / 1px floor).
    await expect
      .poll(async () => {
        const box = await headerB.boundingBox();
        return box ? Math.round(box.width) : 0;
      }, { timeout: 3_000 })
      .toBeGreaterThan(Math.round(initialWidth) + 30);
  });

  test('truncated cell gets a title attribute with the full text', async ({ page }) => {
    // Force truncation by editing cell A3 to hold a long string AND narrowing
    // column A via the resize handle. The tooltip detection fires via
    // useLayoutEffect on scrollWidth > clientWidth, so a narrow column plus
    // a long cell value guarantees truncation regardless of font-metrics.
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/tooltip.xlsx',
      name: 'tooltip.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Write a long string into cell A3 (spreadsheet-cell-2-0).
    const target = page.getByTestId('spreadsheet-cell-2-0');
    await target.dblclick();
    const longValue = 'This is a deliberately long cell value to force truncation';
    const input = page.getByTestId('spreadsheet-cell-input-2-0');
    await expect(input).toBeVisible();
    await input.fill(longValue);
    await input.press('Enter');

    // Re-select so the layout effect re-runs with the latest width.
    await target.click();

    // Narrow column A down to 80px.
    const headerA = page.getByTestId('spreadsheet-column-header-A');
    const handle = page.getByTestId('spreadsheet-column-resize-A');
    const headerBox = await headerA.boundingBox();
    const handleBox = await handle.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const targetWidth = 80;
    const delta = targetWidth - headerBox!.width;
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2 + delta,
      handleBox!.y + handleBox!.height / 2,
      { steps: 10 }
    );
    await page.mouse.up();

    // After the resize, the cell should have a title attribute matching
    // the full long string.
    await expect.poll(
      async () => target.getAttribute('title'),
      { timeout: 3_000 }
    ).toBe(longValue);
  });
});
