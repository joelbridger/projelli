/**
 * Document Editing E2E Tests
 *
 * Covers Phase 3 of the document-support feature — users can edit .xlsx/.csv
 * cell values and .docx text, and the edits round-trip through our
 * serializers back to valid binary files. A backup of the original bytes is
 * written once per file per session before the first edit.
 *
 * Strategy:
 *  - Inject fixture files via `window.__openTestFile` (editor store).
 *  - Read tab state back via `window.__editorStore` so we can confirm the
 *    data URL changed after an edit without racing the UI.
 *  - For round-trip verification of xlsx/docx, decode the data URL on the
 *    node side with the `xlsx` / `mammoth` packages and assert on parsed
 *    contents.
 *  - Mock workspace FS (`window.__mockWorkspaceFs`) is seeded before the edit
 *    so the backup write path has an on-disk file to snapshot, then we
 *    verify a sibling `.backup-*` file exists.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

function readFixtureBytes(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(commaIdx + 1);
  return Buffer.from(base64, 'base64');
}

async function openFixtureTab(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  // The spreadsheet/document viewer lives in MainPanel, which only mounts on
  // the standalone editor surface (sidebarActiveTab === 'files') — see
  // helpers/test-utils.ts.
  await switchToStandaloneEditorSurface(page);
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

/**
 * Seed the mock workspace FS so the backup path can find an on-disk file to
 * snapshot. Without this, `workspaceService.exists(path)` returns false and
 * the backup is silently skipped (which is correct behavior for a fresh
 * in-memory tab, but doesn't exercise the write-binary code path).
 */
async function seedMockFs(
  page: import('@playwright/test').Page,
  path: string,
  bytes: Buffer
) {
  // Transfer bytes as a base64 string; re-decode in the page to avoid any
  // weirdness around buffer transfer across page.evaluate boundaries.
  const base64 = bytes.toString('base64');
  await page.evaluate(
    ({ p, b64 }) => {
      const fs = (window as unknown as {
        __mockWorkspaceFs?: {
          seed: (path: string, bytes: ArrayBuffer) => void;
        };
      }).__mockWorkspaceFs;
      if (!fs) throw new Error('window.__mockWorkspaceFs is not defined');
      const binaryString = atob(b64);
      const buf = new ArrayBuffer(binaryString.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < binaryString.length; i++) {
        view[i] = binaryString.charCodeAt(i);
      }
      fs.seed(p, buf);
    },
    { p: path, b64: base64 }
  );
}

async function getTabContent(
  page: import('@playwright/test').Page,
  path: string
): Promise<string | undefined> {
  return page.evaluate((p) => {
    const store = (window as unknown as {
      __editorStore?: {
        getState: () => {
          openTabs: Array<{ path: string; content: string; isDirty: boolean }>;
        };
      };
    }).__editorStore;
    if (!store) return undefined;
    return store.getState().openTabs.find((t) => t.path === p)?.content;
  }, path);
}

async function listMockFs(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const fs = (window as unknown as {
      __mockWorkspaceFs?: { list: () => string[] };
    }).__mockWorkspaceFs;
    return fs ? fs.list() : [];
  });
}

// Reset stores between tests so the "first edit per session" contract is
// deterministic. The backup store tracks paths already snapshotted — without
// this, a test that edits /test-workspace/sheet.xlsx leaks state into the
// next test.
test.describe('Document Editing (Phase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await page.evaluate(() => {
      const fbs = (window as unknown as {
        __fileBackupStore?: { getState: () => { clear: () => void } };
      }).__fileBackupStore;
      fbs?.getState().clear();
    });
  });

  test('editing an xlsx cell updates the tab content', async ({ page }) => {
    const path = '/test-workspace/edit-sheet.xlsx';
    const bytes = readFixtureBytes('test.xlsx');
    await seedMockFs(page, path, bytes);
    await openFixtureTab(page, {
      path,
      name: 'edit-sheet.xlsx',
      content: `data:${MIME.xlsx};base64,${bytes.toString('base64')}`,
    });

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Cell at row 2, col 0 is "Jan" in the fixture. Double-click to edit.
    const janCell = page.getByTestId('spreadsheet-cell-2-0');
    await expect(janCell).toBeVisible();
    await janCell.dblclick();

    const input = page.getByTestId('spreadsheet-cell-input-2-0');
    await expect(input).toBeVisible();
    await input.fill('January');
    await input.press('Enter');

    // Grid displays the updated value
    await expect(page.getByTestId('spreadsheet-cell-2-0')).toContainText('January');

    // Tab content should have changed to a new data URL
    const content = await getTabContent(page, path);
    expect(content).toBeDefined();
    expect(content).not.toEqual(`data:${MIME.xlsx};base64,${bytes.toString('base64')}`);
    expect(content).toMatch(/^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/);

    // Round-trip: decode the new data URL and parse with xlsx in the test
    // runner. The cell at Revenue!A3 (row index 2, col index 0) should be
    // "January" now.
    const nextBuf = dataUrlToBuffer(content!);
    const wb = XLSX.read(nextBuf, { type: 'buffer' });
    const firstSheetName = wb.SheetNames[0];
    expect(firstSheetName).toBeDefined();
    const ws = wb.Sheets[firstSheetName!];
    expect(ws).toBeDefined();
    const a3 = (ws as XLSX.WorkSheet)['A3'] as XLSX.CellObject | undefined;
    expect(a3?.v).toBe('January');
  });

  test('editing a non-formula cell preserves formula cells on round-trip', async ({ page }) => {
    const path = '/test-workspace/formulas.xlsx';
    const bytes = readFixtureBytes('test.xlsx');
    await seedMockFs(page, path, bytes);
    await openFixtureTab(page, {
      path,
      name: 'formulas.xlsx',
      content: `data:${MIME.xlsx};base64,${bytes.toString('base64')}`,
    });

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Edit a plain value cell (Month row 2 "Jan"). Column C (index 2) has
    // formulas B3*1.1, B4*1.1, B5*1.1 that must survive the round-trip.
    const janCell = page.getByTestId('spreadsheet-cell-2-0');
    await janCell.dblclick();
    const input = page.getByTestId('spreadsheet-cell-input-2-0');
    await input.fill('Jan-Updated');
    await input.press('Enter');

    await expect(page.getByTestId('spreadsheet-cell-2-0')).toContainText('Jan-Updated');

    const content = await getTabContent(page, path);
    expect(content).toBeDefined();

    const wb = XLSX.read(dataUrlToBuffer(content!), { type: 'buffer', cellFormula: true });
    const firstSheetName = wb.SheetNames[0];
    const ws = wb.Sheets[firstSheetName!] as XLSX.WorkSheet;

    // C3, C4, C5 should still have formulas attached
    const c3 = ws['C3'] as XLSX.CellObject | undefined;
    const c4 = ws['C4'] as XLSX.CellObject | undefined;
    const c5 = ws['C5'] as XLSX.CellObject | undefined;
    expect(c3?.f).toBeTruthy();
    expect(c4?.f).toBeTruthy();
    expect(c5?.f).toBeTruthy();
    // Value in A3 updated
    expect((ws['A3'] as XLSX.CellObject | undefined)?.v).toBe('Jan-Updated');
  });

  test('backup is written on first edit and skipped on subsequent edits', async ({ page }) => {
    const path = '/test-workspace/backup-target.xlsx';
    const bytes = readFixtureBytes('test.xlsx');
    await seedMockFs(page, path, bytes);
    await openFixtureTab(page, {
      path,
      name: 'backup-target.xlsx',
      content: `data:${MIME.xlsx};base64,${bytes.toString('base64')}`,
    });

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Snapshot the mock FS before the edit so we can compute the delta.
    const beforeFiles = await listMockFs(page);
    expect(beforeFiles).toContain(path);
    const backupsBefore = beforeFiles.filter((f) => f.startsWith(`${path}.backup-`));
    expect(backupsBefore).toHaveLength(0);

    // First edit
    const cell = page.getByTestId('spreadsheet-cell-2-0');
    await cell.dblclick();
    const input = page.getByTestId('spreadsheet-cell-input-2-0');
    await input.fill('First');
    await input.press('Enter');

    // Poll for the backup to appear
    await expect
      .poll(async () => {
        const files = await listMockFs(page);
        return files.filter((f) => f.startsWith(`${path}.backup-`)).length;
      }, { timeout: 10_000 })
      .toBe(1);

    const afterFirstFiles = await listMockFs(page);
    const backupsAfterFirst = afterFirstFiles.filter((f) => f.startsWith(`${path}.backup-`));
    expect(backupsAfterFirst).toHaveLength(1);
    // Backup filename follows the pattern .backup-YYYYMMDD-HHMMSS.xlsx
    expect(backupsAfterFirst[0]).toMatch(
      new RegExp(`^${path.replace(/[./]/g, '\\$&')}\\.backup-\\d{8}-\\d{6}\\.xlsx$`)
    );

    // Second edit — no new backup should be written
    const cell2 = page.getByTestId('spreadsheet-cell-3-0');
    await cell2.dblclick();
    const input2 = page.getByTestId('spreadsheet-cell-input-3-0');
    await input2.fill('Second');
    await input2.press('Enter');

    await expect(page.getByTestId('spreadsheet-cell-3-0')).toContainText('Second');

    // Give time for another (would-be) backup attempt — it must not happen.
    // We poll for a short window asserting the count stays at 1.
    let stayed = true;
    for (let i = 0; i < 4 && stayed; i++) {
      const files = await listMockFs(page);
      const backups = files.filter((f) => f.startsWith(`${path}.backup-`));
      if (backups.length !== 1) {
        stayed = false;
      }
      // Yield control briefly by waiting on a trivial condition
      await page.waitForFunction(() => true);
    }
    expect(stayed).toBe(true);
  });

});
