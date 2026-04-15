/**
 * Legacy .doc Fallback E2E Tests (Phase 5)
 *
 * The `.doc` (pre-2007 binary Word) fallback in MainPanel has three states:
 *
 *   1. Browser (not Tauri) — no conversion possible, just the fallback + download
 *   2. Tauri + LibreOffice detected — "Convert to .docx" primary button
 *   3. Tauri + LibreOffice NOT detected — install instructions pointing at libreoffice.org
 *
 * Test mode (`?testMode=true`) runs in a real browser, so `isTauriEnvironment()`
 * from BackendFactory naturally returns false (no `window.__TAURI__`). To
 * exercise states 2 and 3 we stub both globals Tauri v2 checks:
 *
 *   - `window.isTauri = true`                        → so core's `isTauri()` returns true
 *   - `window.__TAURI__ = {}`                        → so BackendFactory's `isTauriEnvironment()` returns true
 *   - `window.__TAURI_INTERNALS__.invoke(cmd, args)` → so `invoke()` resolves
 *
 * We inject these via `page.addInitScript` so the stubs land before the app's
 * bundle runs. Each test installs its own handler map for the command names
 * it expects to see (`detect_libreoffice`, `convert_doc_to_docx`).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const DOC_MIME = 'application/msword';

/**
 * Read the `test.docx` fixture and return it as a data URL with the `.doc`
 * MIME type. MainPanel branches on extension only, so the actual bytes don't
 * matter for the fallback UI path — we just need something non-empty.
 */
function docFixtureAsDataUrl(): string {
  const bytes = readFileSync(join(fixturesDir, 'test.docx'));
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${DOC_MIME};base64,${base64}`;
}

async function openDocTab(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  await page.evaluate((a) => {
    const fn = (window as unknown as { __openTestFile?: (p: string, n: string, c: string) => void })
      .__openTestFile;
    if (!fn) throw new Error('window.__openTestFile is not defined — is testMode=true?');
    fn(a.path, a.name, a.content);
  }, args);
}

/**
 * Install a Tauri-like global shim before the page loads. Handlers map command
 * names to static serializable return values — functions can't be passed
 * through `addInitScript` because its argument is JSON-serialized.
 *
 * Must be called BEFORE `page.goto()`.
 */
async function installTauriMock(
  page: import('@playwright/test').Page,
  handlers: Record<string, unknown>
) {
  await page.addInitScript((handlerEntries) => {
    // Tauri v2's core.js checks `(globalThis || window).isTauri` in isTauri()
    // and `window.__TAURI_INTERNALS__.invoke(cmd, args)` inside invoke().
    // BackendFactory separately checks `'__TAURI__' in window`. Set all three.
    const handlerMap = new Map<string, unknown>(handlerEntries);
    (window as unknown as { isTauri: boolean }).isTauri = true;
    (window as unknown as { __TAURI__: Record<string, unknown> }).__TAURI__ = {};
    (window as unknown as { __invokeCalls: string[] }).__invokeCalls = [];
    (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: unknown) => {
        (window as unknown as { __invokeCalls: string[] }).__invokeCalls.push(
          `${cmd}:${JSON.stringify(args ?? {})}`
        );
        if (!handlerMap.has(cmd)) {
          throw new Error(`[tauri-mock] No handler for command: ${cmd}`);
        }
        return handlerMap.get(cmd);
      },
    };
  }, Object.entries(handlers));
}

test.describe('Legacy .doc Fallback (Phase 5)', () => {
  test('browser: shows plain fallback with download button and no convert button', async ({
    page,
  }) => {
    // No Tauri mock — real browser, real isTauriEnvironment() === false
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openDocTab(page, {
      path: '/test-workspace/fixtures/legacy.doc',
      name: 'legacy.doc',
      content: docFixtureAsDataUrl(),
    });

    const fallback = page.getByTestId('doc-legacy-fallback');
    await expect(fallback).toBeVisible({ timeout: 20_000 });

    // Browser branch: no Convert button, no install message
    await expect(page.getByTestId('doc-convert-button')).toHaveCount(0);
    await expect(page.getByTestId('doc-convert-install-libreoffice')).toHaveCount(0);

    // Browser guidance text + Download File button both present
    await expect(fallback).toContainText('Open it in Word');
    const download = page.getByRole('button', { name: 'Download File' });
    await expect(download).toBeVisible();
    await expect(download).toBeEnabled();
  });

  test('tauri + libreoffice detected: shows convert button and opens converted .docx', async ({
    page,
  }) => {
    const fakeSofficePath = '/usr/bin/soffice';
    const fakeOutputPath = '/test-workspace/fixtures/legacy.docx';

    await installTauriMock(page, {
      detect_libreoffice: fakeSofficePath,
      convert_doc_to_docx: fakeOutputPath,
    });

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openDocTab(page, {
      path: '/test-workspace/fixtures/legacy.doc',
      name: 'legacy.doc',
      content: docFixtureAsDataUrl(),
    });

    await expect(page.getByTestId('doc-legacy-fallback')).toBeVisible({ timeout: 20_000 });

    // Convert button appears once detection resolves
    const convert = page.getByTestId('doc-convert-button');
    await expect(convert).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('doc-convert-install-libreoffice')).toHaveCount(0);

    // Seed the mock FS so the app's openFile (which reads through the workspace
    // service) can find content for the converted .docx. Without this, openFile
    // fails with "Not found" inside the mock's readFileBinary and the new tab
    // never appears.
    await page.evaluate(
      async ({ path, dataUrl }) => {
        const resp = await fetch(dataUrl);
        const buf = await resp.arrayBuffer();
        const mock = (window as unknown as {
          __mockWorkspaceFs?: { seed: (p: string, b: ArrayBuffer) => void };
        }).__mockWorkspaceFs;
        if (!mock) throw new Error('[test] __mockWorkspaceFs missing');
        mock.seed(path, buf);
      },
      { path: fakeOutputPath, dataUrl: docFixtureAsDataUrl() }
    );

    await hardClick(convert);

    // After conversion, the new .docx tab should be opened. We don't assert
    // the DocxEditor is mounted (that depends on mammoth parsing the bytes) —
    // just that a tab with the new name exists in the editor store.
    await expect.poll(
      async () =>
        await page.evaluate(() => {
          const store = (window as unknown as {
            __editorStore?: { getState: () => { openTabs: { path: string }[] } };
          }).__editorStore;
          return store?.getState().openTabs.map((t) => t.path) ?? [];
        }),
      { timeout: 15_000 }
    ).toContain(fakeOutputPath);

    // Also sanity-check that the convert command was invoked with the right
    // inputPath, so that if someone changes the command shape in Rust or the
    // JS wrapper the test fails with a meaningful diff.
    const invokeCalls = await page.evaluate(
      () => (window as unknown as { __invokeCalls?: string[] }).__invokeCalls ?? []
    );
    expect(invokeCalls).toContain(
      'convert_doc_to_docx:{"inputPath":"/test-workspace/fixtures/legacy.doc"}'
    );
  });

  test('tauri + libreoffice NOT detected: shows install message, no convert button', async ({
    page,
  }) => {
    await installTauriMock(page, {
      detect_libreoffice: null,
    });

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openDocTab(page, {
      path: '/test-workspace/fixtures/legacy.doc',
      name: 'legacy.doc',
      content: docFixtureAsDataUrl(),
    });

    await expect(page.getByTestId('doc-legacy-fallback')).toBeVisible({ timeout: 20_000 });

    // Install message appears, no convert button
    await expect(page.getByTestId('doc-convert-install-libreoffice')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('doc-convert-button')).toHaveCount(0);

    // libreoffice.org link present
    const link = page.getByRole('link', { name: /libreoffice\.org/i });
    await expect(link).toBeVisible();

    // Download File still available as escape hatch
    const download = page.getByRole('button', { name: 'Download File' });
    await expect(download).toBeVisible();
  });
});
