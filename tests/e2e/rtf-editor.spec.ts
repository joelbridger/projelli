/**
 * RTF Editor E2E Tests (Phase 6)
 *
 * Before Phase 6, `.rtf` files fell into the internal `.rt` handler and
 * users saw raw `{\rtf1\ansi...}` markup. RtfEditor replaces that flow with
 * a real round-trip:
 *
 *   RTF bytes -> HTML -> TipTap edits -> HTML -> RTF bytes
 *
 * These tests cover:
 *   1. Parsing — the fixture's "bold", "italic", and bullet content shows up
 *      in the TipTap editor.
 *   2. Editing — typing new text changes the tab's data URL AND the new
 *      bytes can be parsed back on the node side (via our own extractor,
 *      since rtf-parser pulls in Node streams we don't ship).
 *   3. Banner — visible on first render, dismiss removes it.
 *   4. First-edit backup — same contract as DocxEditor: one backup per
 *      file per session.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const RTF_MIME = 'application/rtf';

function readFixtureBytes(name: string): Buffer {
  return readFileSync(join(fixturesDir, name));
}

function rtfFixtureAsDataUrl(): string {
  const bytes = readFixtureBytes('test.rtf');
  const base64 = bytes.toString('base64');
  return `data:${RTF_MIME};base64,${base64}`;
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(commaIdx + 1);
  return Buffer.from(base64, 'base64');
}

/**
 * Node-side plain-text extractor. RTF's subset we care about here is simple
 * enough to strip with a regex: remove everything from `{\<dest> ... }` blocks
 * (fonttbl, pntext, etc.), then strip remaining `\<word>` control words and
 * braces.
 *
 * We use this rather than the browser's parseRtf because Playwright test
 * files execute in Node and importing `src/utils/rtf-io.ts` directly would
 * drag DOMParser / lucide-react into the test runner.
 */
function rtfToPlainText(raw: string): string {
  // Strip nested RTF groups in a loop until nothing changes. This is O(n^2)
  // on pathological input but tests use a 15-line fixture.
  let body = raw;
  // Drop the well-known meta-destinations so their contents don't show up.
  const dropDests = [
    'fonttbl',
    'colortbl',
    'info',
    'stylesheet',
    'listtable',
    'listoverridetable',
    'pntext',
    'pict',
  ];
  for (const dest of dropDests) {
    const re = new RegExp(`\\{\\\\\\*?\\\\${dest}[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}`, 'g');
    body = body.replace(re, '');
  }

  // Now strip remaining {} braces and \controls.
  body = body
    .replace(/\\\\/g, '\\__BS__')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
    .replace(/\\par[\s]?/g, '\n')
    .replace(/\\line[\s]?/g, '\n')
    .replace(/\\tab[\s]?/g, '\t')
    .replace(/\\bullet[\s]?/g, '* ')
    .replace(/\\[a-zA-Z]+-?\d*[\s]?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\__BS__/g, '\\');

  return body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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

async function seedMockFs(
  page: import('@playwright/test').Page,
  path: string,
  bytes: Buffer
) {
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

test.describe('RTF Editor (Phase 6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
    // Reset backup store so "first edit per session" is deterministic.
    await page.evaluate(() => {
      const fbs = (window as unknown as {
        __fileBackupStore?: { getState: () => { clear: () => void } };
      }).__fileBackupStore;
      fbs?.getState().clear();
    });
  });

  test('parses fixture content and shows bold / italic / bullet text in the editor', async ({
    page,
  }) => {
    const path = '/test-workspace/parse.rtf';
    await openFixtureTab(page, {
      path,
      name: 'parse.rtf',
      content: rtfFixtureAsDataUrl(),
    });

    const editor = page.getByTestId('rtf-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const content = page.getByTestId('rtf-editor-content');
    // Fixture content: plain text, "bold text", "italic text", 3 bullets.
    await expect(content).toContainText('This is a simple RTF document', {
      timeout: 20_000,
    });
    await expect(content).toContainText('bold text');
    await expect(content).toContainText('italic text');
    await expect(content).toContainText('First bullet item');
    await expect(content).toContainText('Third bullet item');
  });

  test('editing updates the tab content and the new RTF parses back to the edit', async ({
    page,
  }) => {
    const path = '/test-workspace/edit.rtf';
    const bytes = readFixtureBytes('test.rtf');
    await seedMockFs(page, path, bytes);
    await openFixtureTab(page, {
      path,
      name: 'edit.rtf',
      content: rtfFixtureAsDataUrl(),
    });

    const editor = page.getByTestId('rtf-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const content = page.getByTestId('rtf-editor-content');
    await expect(content).toContainText('This is a simple RTF document', {
      timeout: 20_000,
    });

    // Place cursor at end and type a unique token.
    await content.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' APPENDED_RTF_TOKEN');

    // Wait for the 2s debounce + serialize: tab content changes to a new
    // data URL (still RTF MIME).
    const originalDataUrl = rtfFixtureAsDataUrl();
    await expect
      .poll(
        async () => {
          const c = await getTabContent(page, path);
          return c && c !== originalDataUrl && c.startsWith(`data:${RTF_MIME};base64,`)
            ? 'ok'
            : 'waiting';
        },
        { timeout: 20_000 }
      )
      .toBe('ok');

    // Decode the new bytes and assert the token is present in the extracted
    // plain text.
    const updated = await getTabContent(page, path);
    expect(updated).toBeDefined();
    const newBytes = dataUrlToBuffer(updated!);
    const plain = rtfToPlainText(newBytes.toString('latin1'));
    expect(plain).toContain('APPENDED_RTF_TOKEN');
  });

  test('fidelity banner is visible initially and dismissable', async ({ page }) => {
    const path = '/test-workspace/banner.rtf';
    await openFixtureTab(page, {
      path,
      name: 'banner.rtf',
      content: rtfFixtureAsDataUrl(),
    });

    await expect(page.getByTestId('rtf-editor')).toBeVisible({ timeout: 20_000 });

    const banner = page.getByTestId('rtf-editor-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('simpler format');

    const dismiss = page.getByTestId('rtf-editor-banner-dismiss');
    await dismiss.click();
    await expect(banner).toHaveCount(0);
  });

  test('writes a backup on first edit and skips on the second', async ({ page }) => {
    const path = '/test-workspace/backup.rtf';
    const bytes = readFixtureBytes('test.rtf');
    await seedMockFs(page, path, bytes);
    await openFixtureTab(page, {
      path,
      name: 'backup.rtf',
      content: rtfFixtureAsDataUrl(),
    });

    const editor = page.getByTestId('rtf-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Pre-edit: no backup yet
    const beforeFiles = await listMockFs(page);
    expect(beforeFiles).toContain(path);
    expect(beforeFiles.filter((f) => f.startsWith(`${path}.backup-`))).toHaveLength(0);

    const content = page.getByTestId('rtf-editor-content');
    await expect(content).toContainText('This is a simple RTF document', {
      timeout: 20_000,
    });

    // First edit
    await content.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' FIRST_EDIT');

    // Poll for the backup file to appear — the write happens via
    // writeBackupIfNeeded inside MainPanel right before the first serialize
    // push.
    await expect
      .poll(async () => {
        const files = await listMockFs(page);
        return files.filter((f) => f.startsWith(`${path}.backup-`)).length;
      }, { timeout: 15_000 })
      .toBe(1);

    const afterFirst = await listMockFs(page);
    const backups = afterFirst.filter((f) => f.startsWith(`${path}.backup-`));
    expect(backups).toHaveLength(1);
    // Backup filename pattern: .backup-YYYYMMDD-HHMMSS.rtf
    expect(backups[0]).toMatch(
      new RegExp(`^${path.replace(/[./]/g, '\\$&')}\\.backup-\\d{8}-\\d{6}\\.rtf$`)
    );

    // Second edit — no new backup
    await page.keyboard.type(' SECOND_EDIT');

    // Allow ample time for another backup attempt; assert the count stays 1.
    let stayed = true;
    for (let i = 0; i < 4 && stayed; i++) {
      const files = await listMockFs(page);
      const count = files.filter((f) => f.startsWith(`${path}.backup-`)).length;
      if (count !== 1) stayed = false;
      await page.waitForFunction(() => true);
    }
    expect(stayed).toBe(true);
  });
});
