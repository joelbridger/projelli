/**
 * PowerPoint Viewer E2E Tests (Phase 6)
 *
 * PowerPoint files (`.pptx` / `.ppt`) render inside the app by converting to
 * PDF via a native LibreOffice subprocess (`convert_ppt_to_pdf`). The viewer
 * has four states:
 *
 *   1. Browser (non-Tauri) — desktop-only fallback + Download button
 *   2. Tauri + LibreOffice detected — spinner while converting, then PDF render
 *   3. Tauri + LibreOffice NOT detected — install instructions + Download
 *   4. Conversion error — error panel with Try again + Download
 *
 * The real desktop flow exercises state 2. In tests we exercise 1 (no Tauri
 * mock), 3 (Tauri mock returning null from detect_libreoffice), and 4
 * (Tauri mock returning a rejected promise from convert_ppt_to_pdf). State 2
 * involves reading the produced PDF back off disk via the Tauri fs plugin,
 * which is too tangled to mock reliably — verified in the desktop app.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function pptxFixtureAsDataUrl(): string {
  const bytes = readFileSync(join(fixturesDir, 'test.pptx'));
  const base64 = Buffer.from(bytes).toString('base64');
  return `data:${PPTX_MIME};base64,${base64}`;
}

async function openPptxTab(
  page: import('@playwright/test').Page,
  args: { path: string; name: string; content: string }
) {
  // MainPanel (the PowerPoint viewer) only mounts on the standalone editor
  // surface (sidebarActiveTab === 'files') — see helpers/test-utils.ts.
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
 * Install a Tauri-like global shim before the page loads. Handlers map
 * command names either to a concrete value (resolves with that value) or the
 * special sentinel object `{ __reject: message }` (rejects with the message).
 * Functions can't be passed through `addInitScript` — args are JSON-serialized.
 */
async function installTauriMock(
  page: import('@playwright/test').Page,
  handlers: Record<string, unknown>
) {
  await page.addInitScript((handlerEntries) => {
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
        const value = handlerMap.get(cmd);
        // Sentinel shape: `{ __reject: "message" }` forces a rejection so we
        // can exercise the error-state branch in PresentationViewer.
        if (
          value &&
          typeof value === 'object' &&
          '__reject' in (value as Record<string, unknown>)
        ) {
          throw new Error(String((value as { __reject: unknown }).__reject));
        }
        return value;
      },
    };
  }, Object.entries(handlers));
}

test.describe('PowerPoint Viewer (Phase 6)', () => {
  test('browser: shows basic slide preview fallback', async ({ page }) => {
    // No Tauri mock: the browser uses the pure-JS basic preview path.
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openPptxTab(page, {
      path: '/test-workspace/fixtures/test.pptx',
      name: 'test.pptx',
      content: pptxFixtureAsDataUrl(),
    });

    const viewer = page.getByTestId('presentation-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId('presentation-fallback-banner')).toBeVisible();
    await expect(page.getByTestId('fallback-slide-1')).toContainText('Q1 Review');
    await expect(page.getByTestId('fallback-slide-2')).toContainText('Revenue');
    await expect(page.getByTestId('presentation-install-libreoffice')).toHaveCount(0);
  });

  test('tauri + libreoffice NOT detected: shows basic slide preview, no conversion', async ({
    page,
  }) => {
    await installTauriMock(page, {
      detect_libreoffice: null,
    });

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openPptxTab(page, {
      path: '/test-workspace/fixtures/test.pptx',
      name: 'test.pptx',
      content: pptxFixtureAsDataUrl(),
    });

    const viewer = page.getByTestId('presentation-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId('presentation-fallback-banner')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('fallback-slide-1')).toContainText('Q1 Review');
    await expect(page.getByTestId('presentation-install-libreoffice')).toHaveCount(0);

    // The conversion command should NOT be invoked when detection returned null;
    // the viewer uses the basic preview instead.
    const invokeCalls = await page.evaluate(
      () => (window as unknown as { __invokeCalls?: string[] }).__invokeCalls ?? []
    );
    expect(invokeCalls.some((c) => c.startsWith('convert_ppt_to_pdf:'))).toBe(false);
  });

  test('tauri + libreoffice detected but conversion fails: shows error + Try again', async ({
    page,
  }) => {
    // Seed LibreOffice as detected, but make the conversion call reject so
    // we land in the error-state UI. This exercises the state 4 branch.
    await installTauriMock(page, {
      detect_libreoffice: '/usr/bin/soffice',
      convert_ppt_to_pdf: { __reject: 'LibreOffice crashed' },
    });

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await openPptxTab(page, {
      path: '/test-workspace/fixtures/test.pptx',
      name: 'test.pptx',
      content: pptxFixtureAsDataUrl(),
    });

    const viewer = page.getByTestId('presentation-viewer');
    await expect(viewer).toBeVisible({ timeout: 20_000 });

    // Wait for the error UI to land
    const error = page.getByTestId('presentation-error');
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText('LibreOffice crashed');

    // "Try again" button is present, along with a Download File escape hatch
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    await expect(tryAgain).toBeVisible();
    const download = page.getByRole('button', { name: 'Download File' });
    await expect(download).toBeVisible();

    // Verify the command was invoked with the expected inputPath. If someone
    // renames the Rust command or changes the JS wrapper, this test fails
    // with a clear diff.
    const invokeCalls = await page.evaluate(
      () => (window as unknown as { __invokeCalls?: string[] }).__invokeCalls ?? []
    );
    expect(invokeCalls).toContain(
      'convert_ppt_to_pdf:{"inputPath":"/test-workspace/fixtures/test.pptx"}'
    );
  });
});
