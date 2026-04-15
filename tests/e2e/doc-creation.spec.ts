/**
 * Document Creation E2E Tests
 *
 * Covers Phase 4 of the document-support feature — users can create new
 * blank `.xlsx`, `.csv`, and `.docx` files from the file-tree "New File"
 * dropdown.
 *
 * Strategy:
 *  - The app exposes `window.__openTestFile`, `window.__editorStore`, and
 *    `window.__mockWorkspaceFs` in test mode. We drive the real create
 *    flow (click the dropdown, fill the prompt dialog, assert a tab opens)
 *    and then introspect the editor store + mock FS to verify the bytes.
 *  - For round-trip verification we decode the tab's data URL on the node
 *    side with the `xlsx` and `mammoth` packages, same pattern as
 *    doc-editing.spec.ts.
 */

import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(commaIdx + 1);
  return Buffer.from(base64, 'base64');
}

async function getActiveTab(page: Page): Promise<{
  path: string;
  name: string;
  content: string;
} | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __editorStore?: {
        getState: () => {
          openTabs: Array<{ path: string; name: string; content: string }>;
          activeTabPath: string | null;
        };
      };
    }).__editorStore;
    if (!store) return undefined;
    const s = store.getState();
    return s.openTabs.find((t) => t.path === s.activeTabPath);
  });
}

async function listMockFs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fs = (window as unknown as {
      __mockWorkspaceFs?: { list: () => string[] };
    }).__mockWorkspaceFs;
    return fs ? fs.list() : [];
  });
}

/**
 * Drive the full create flow: click the "New File" menu trigger, pick the
 * given type, fill the prompt dialog, and confirm. Returns when the modal
 * closes (the file is written and the tab is opened).
 */
async function runCreateFlow(
  page: Page,
  typeTestId: string,
  filename: string
): Promise<void> {
  const trigger = page.getByTestId('new-file-menu-trigger');
  await hardClick(trigger);

  const typeOption = page.getByTestId(typeTestId);
  await hardClick(typeOption);

  // PromptDialog renders a single Input textbox inside a Radix dialog.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole('textbox');
  await expect(input).toBeVisible();
  await input.fill(filename);
  await input.press('Enter');

  // Dialog closes on confirm
  await expect(dialog).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Document Creation (Phase 4) — File Tree menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    await hardClick(page.getByTestId('sidebar-tab-files'));
  });

  test('creates a blank .xlsx and opens it in the spreadsheet viewer', async ({ page }) => {
    await runCreateFlow(page, 'new-file-type-xlsx', 'my-sheet');

    // Spreadsheet viewer appears for the new tab
    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Tab state: path ends in .xlsx, content is an xlsx data URL
    const tab = await getActiveTab(page);
    expect(tab).toBeDefined();
    expect(tab!.name).toBe('my-sheet.xlsx');
    expect(tab!.content).toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet;base64,/
    );

    // File on disk (mock FS)
    const files = await listMockFs(page);
    expect(files.some((f) => f.endsWith('/docs/my-sheet.xlsx'))).toBe(true);

    // Round-trip: the data URL decodes as a valid xlsx with a Sheet1
    const buf = dataUrlToBuffer(tab!.content);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toContain('Sheet1');
  });

  test('creates a blank .csv and opens it in the spreadsheet viewer', async ({ page }) => {
    await runCreateFlow(page, 'new-file-type-csv', 'blank-data');

    const viewer = page.getByTestId('spreadsheet-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    const tab = await getActiveTab(page);
    expect(tab).toBeDefined();
    expect(tab!.name).toBe('blank-data.csv');
    expect(tab!.content).toMatch(/^data:text\/csv;base64,/);

    const files = await listMockFs(page);
    expect(files.some((f) => f.endsWith('/docs/blank-data.csv'))).toBe(true);
  });

  test('creates a blank .docx and opens it in the DocxEditor', async ({ page }) => {
    await runCreateFlow(page, 'new-file-type-docx', 'fresh-doc');

    // DocxEditor renders a tiptap editor with this testid
    const editor = page.getByTestId('docx-editor');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    const tab = await getActiveTab(page);
    expect(tab).toBeDefined();
    expect(tab!.name).toBe('fresh-doc.docx');
    expect(tab!.content).toMatch(
      /^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/
    );

    // On-disk file exists
    const files = await listMockFs(page);
    expect(files.some((f) => f.endsWith('/docs/fresh-doc.docx'))).toBe(true);

    // Round-trip: the bytes parse as a valid docx with mammoth returning
    // (possibly empty) raw text without throwing.
    const buf = dataUrlToBuffer(tab!.content);
    const res = await mammoth.extractRawText({ buffer: buf });
    expect(typeof res.value).toBe('string');
  });

  test('filename prefill: extension is auto-appended if omitted', async ({ page }) => {
    // Users shouldn't need to type ".xlsx" themselves. Verify the handler
    // appends the extension when the user gives a bare name, and does NOT
    // double-append when the user types the extension themselves.
    await runCreateFlow(page, 'new-file-type-xlsx', 'already.xlsx');

    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    const tab = await getActiveTab(page);
    expect(tab!.name).toBe('already.xlsx');
  });
});
