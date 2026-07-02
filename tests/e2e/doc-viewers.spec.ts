/**
 * Document Viewer E2E Tests
 *
 * Covers the Phase 1 in-app viewers for `.xlsx`, `.csv`, and `.docx`.
 * Fixtures are generated via `node tests/fixtures/generate.mjs`.
 *
 * Strategy: the app exposes `window.__openTestFile` in test mode, which is
 * just the editor store's `openFile(path, name, content)` action. We read the
 * fixture bytes in the test runner, encode them as data URLs, and inject the
 * tab via `page.evaluate`. This avoids touching the Tauri filesystem layer
 * and keeps the spec deterministic.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { hardClick, waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

// ---------------------------------------------------------------------------
// Fixture loading helpers
// ---------------------------------------------------------------------------

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
} as const;

function readFixtureAsDataUrl(name: string, mime: string): string {
  const bytes = readFileSync(join(fixturesDir, name));
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${mime};base64,${base64}`;
}

/**
 * Open a synthetic tab via the test-mode helper. Path/name are arbitrary —
 * MainPanel branches on the extension in `name`, not on disk presence.
 */
async function openFixtureTab(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  // MainPanel (the document viewers) only mounts on the standalone editor
  // surface (sidebarActiveTab === 'files') — see helpers/test-utils.ts.
  await switchToStandaloneEditorSurface(page);
  await page.evaluate((a) => {
    const fn = (window as unknown as { __openTestFile?: (p: string, n: string, c: string) => void })
      .__openTestFile;
    if (!fn) {
      throw new Error('window.__openTestFile is not defined — is testMode=true?');
    }
    fn(a.path, a.name, a.content);
  }, args);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Document Viewers (Phase 1)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('renders an .xlsx file with sheet tabs, merged title, and data cells', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/test.xlsx',
      name: 'test.xlsx',
      content: dataUrl,
    });

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Sheet tabs exist for both sheets
    await expect(page.getByTestId('spreadsheet-sheet-tab-revenue')).toBeVisible();
    await expect(page.getByTestId('spreadsheet-sheet-tab-notes')).toBeVisible();

    // Merged title row: A1:C1 -> origin cell at (0,0) shows "Q1 2026 Revenue"
    await expect(page.getByTestId('spreadsheet-cell-0-0')).toHaveText('Q1 2026 Revenue');

    // Feb row: data row index 3, column index 1 holds 11000
    await expect(page.getByTestId('spreadsheet-cell-3-1')).toHaveText('11000');
  });

  test('renders a .csv file with header row matching the fixture', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.csv', MIME.csv);
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/test.csv',
      name: 'test.csv',
      content: dataUrl,
    });

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // CSVs only have one sheet, so no tab bar; header row is at row index 0
    await expect(page.getByTestId('spreadsheet-cell-0-0')).toHaveText('Week');
    await expect(page.getByTestId('spreadsheet-cell-0-1')).toHaveText('Sign-ups');
    await expect(page.getByTestId('spreadsheet-cell-0-2')).toHaveText('Active Users');
    await expect(page.getByTestId('spreadsheet-cell-0-3')).toHaveText('Revenue');

    // First data row (index 1) shows the W01 value
    await expect(page.getByTestId('spreadsheet-cell-1-0')).toHaveText('2026-W01');
  });

  test('switches between sheets when a tab is clicked', async ({ page }) => {
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/test.xlsx',
      name: 'test.xlsx',
      content: dataUrl,
    });

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });
    // Confirm we start on Revenue
    await expect(page.getByTestId('spreadsheet-cell-0-0')).toHaveText('Q1 2026 Revenue');

    // Switch to Notes
    await hardClick(page.getByTestId('spreadsheet-sheet-tab-notes'));

    // Notes sheet has a single cell at A1
    await expect(page.getByTestId('spreadsheet-cell-0-0')).toHaveText(
      'Q1 numbers are preliminary'
    );
  });

  test('renders a .docx file in the browser read-only preview', async ({ page }) => {
    // In the redesigned 3.0 app, browser mode shows a read-only Word preview.
    // Full tracked-change editing is desktop-only.
    const dataUrl = readFixtureAsDataUrl('test.docx', MIME.docx);
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/test.docx',
      name: 'test.docx',
      content: dataUrl,
    });

    const editor = page.getByTestId('docx-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor).toHaveAttribute('data-mode', 'readonly-fallback');
    await expect(page.getByTestId('docx-editor-readonly-banner')).toContainText(
      'read-only preview'
    );

    const viewer = page.getByTestId('docx-viewer');
    await expect(viewer).toBeVisible();
    await expect(page.getByText('Investor Update — January')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Next Steps')).toBeVisible();
  });

  test('shows the docx error state when given invalid bytes', async ({ page }) => {
    // base64 of "not a docx" — definitely not a valid OOXML zip
    const garbage = `data:${MIME.docx};base64,${Buffer.from('not a docx').toString('base64')}`;
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/broken.docx',
      name: 'broken.docx',
      content: garbage,
    });

    await expect(page.getByTestId('docx-error')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Couldn't open broken.docx")).toBeVisible();
  });

  test('legacy .doc files show a friendly fallback with download button', async ({ page }) => {
    // Reuse the .docx bytes — MainPanel branches on extension, not content,
    // so .doc forces the fallback regardless of what's inside the data URL.
    const dataUrl = readFixtureAsDataUrl('test.docx', MIME.doc);
    await openFixtureTab(page, {
      path: '/test-workspace/fixtures/legacy.doc',
      name: 'legacy.doc',
      content: dataUrl,
    });

    // Phase 5 rewrote the fallback into a DocLegacyFallback component with a
    // `doc-legacy-fallback` testid. In browser test mode (no Tauri mock) the
    // "open in Word" branch renders — match a substring that survives the
    // inline <code> split.
    const fallback = page.getByTestId('doc-legacy-fallback');
    await expect(fallback).toBeVisible({ timeout: 20_000 });
    await expect(fallback).toContainText('Open it in Word');

    // The Download button should be present and enabled
    const download = page.getByRole('button', { name: 'Download File' });
    await expect(download).toBeVisible();
    await expect(download).toBeEnabled();
  });
});
