/**
 * AI Ambient File Context Tests
 *
 * Covers Phase 2 of the document-support feature — any file a founder opens
 * in a tab automatically becomes AI-visible unless they toggle it off.
 *
 * Strategy:
 *  - Inject fixture files via `window.__openTestFile` (editor store).
 *  - Read the ambient store via `window.__fileContextStore`.
 *  - Assert on the prompt the AI will see via `window.__buildSystemPromptForTest`.
 *
 * This sidesteps the real AI provider URLs (which vary and need API keys)
 * while still verifying end-to-end that the system prompt carries the
 * extracted file contents.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
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

/**
 * Duplicate of `pathToTestId` from TabBar.tsx so the spec stays
 * self-contained. Both sides must stay in sync — if you change one, change
 * the other. The mapping is narrow (alphanum + `._-` preserved, everything
 * else collapsed to dashes) and deterministic.
 */
function pathToTestId(path: string): string {
  return path
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

type StoreState = {
  contexts: Record<string, {
    fileName: string;
    path: string;
    extractedText: string;
    tokenEstimate: number;
    truncated: boolean;
    sourceKind: 'spreadsheet' | 'docx' | 'text';
  }>;
  disabledPaths: Record<string, true>;
};

async function readStore(page: import('@playwright/test').Page): Promise<StoreState> {
  return page.evaluate(() => {
    const store = (window as unknown as {
      __fileContextStore?: { getState: () => StoreState };
    }).__fileContextStore;
    if (!store) {
      throw new Error('window.__fileContextStore is not defined — is testMode=true?');
    }
    const state = store.getState();
    return { contexts: state.contexts, disabledPaths: state.disabledPaths };
  });
}

// Extraction is debounced by 300ms inside useOpenFileAIContext, so every
// assertion on the store uses Playwright's auto-retrying `expect.poll` rather
// than racing the debounce.
async function expectContextEventually(
  page: import('@playwright/test').Page,
  path: string,
  predicate: (ctx: StoreState['contexts'][string] | undefined) => boolean
) {
  await expect
    .poll(async () => {
      const state = await readStore(page);
      return predicate(state.contexts[path]);
    }, { timeout: 15_000 })
    .toBe(true);
}

test.describe('AI Ambient File Context (Phase 2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('opening an .xlsx file produces an extracted context with sheet data', async ({ page }) => {
    const path = '/test-workspace/fixtures/revenue.xlsx';
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path,
      name: 'revenue.xlsx',
      content: dataUrl,
    });

    await expectContextEventually(page, path, (ctx) =>
      Boolean(ctx) && ctx!.extractedText.includes('Revenue') && ctx!.extractedText.includes('11000')
    );

    const state = await readStore(page);
    const ctx = state.contexts[path];
    expect(ctx).toBeDefined();
    expect(ctx!.sourceKind).toBe('spreadsheet');
    expect(ctx!.fileName).toBe('revenue.xlsx');
    expect(ctx!.extractedText).toContain('=== Sheet: Revenue ===');
    expect(ctx!.extractedText).toContain('Feb');
    expect(ctx!.tokenEstimate).toBeGreaterThan(0);
  });

  test('toggling the chip removes the file from active contexts', async ({ page }) => {
    const path = '/test-workspace/fixtures/toggle.xlsx';
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path,
      name: 'toggle.xlsx',
      content: dataUrl,
    });

    // Wait for the extraction to land + the chip to appear
    await expectContextEventually(page, path, (ctx) => Boolean(ctx));
    const toggle = page.getByTestId(`ai-context-toggle-${pathToTestId(path)}`);
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // Default: enabled → attribute reflects it, active contexts include path
    await expect(toggle).toHaveAttribute('data-ai-enabled', 'true');

    const beforeState = await readStore(page);
    expect(beforeState.disabledPaths[path]).toBeUndefined();

    await hardClick(toggle);

    // After toggling off the chip flips visual state and the store has the
    // path recorded as disabled.
    await expect(toggle).toHaveAttribute('data-ai-enabled', 'false');
    const afterState = await readStore(page);
    expect(afterState.disabledPaths[path]).toBe(true);

    const activeCount = await page.evaluate((p) => {
      const store = (window as unknown as {
        __fileContextStore?: {
          getState: () => {
            getActiveContexts: () => Array<{ path: string }>;
            isEnabled: (path: string) => boolean;
          };
        };
      }).__fileContextStore;
      const state = store!.getState();
      return {
        enabled: state.isEnabled(p),
        inActive: state.getActiveContexts().some((c) => c.path === p),
      };
    }, path);

    expect(activeCount.enabled).toBe(false);
    expect(activeCount.inActive).toBe(false);
  });

  test('toggle preference persists across a page reload', async ({ page }) => {
    const path = '/test-workspace/fixtures/persist.xlsx';
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path,
      name: 'persist.xlsx',
      content: dataUrl,
    });

    await expectContextEventually(page, path, (ctx) => Boolean(ctx));
    const toggle = page.getByTestId(`ai-context-toggle-${pathToTestId(path)}`);
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await hardClick(toggle);

    // localStorage should have the path recorded
    const pre = await page.evaluate(() => localStorage.getItem('file-context-storage'));
    expect(pre).toBeTruthy();
    expect(pre!).toContain('persist.xlsx');

    await page.reload();
    await waitForTestModeLoad(page);

    // On a fresh load the tab is gone (no persistence of open tabs in test
    // mode for ad-hoc fixtures), but the disabled entry should remain.
    const post = await readStore(page);
    expect(post.disabledPaths[path]).toBe(true);
  });

  test('unsupported file types do not produce a context or a toggle chip', async ({ page }) => {
    const path = '/test-workspace/fixtures/slide.pdf';
    // PDF header bytes — valid enough to pass as "binary" yet we never parse it.
    const fakePdf = 'data:application/pdf;base64,' +
      Buffer.from('%PDF-1.4\n%test\n').toString('base64');
    await openFixtureTab(page, {
      path,
      name: 'slide.pdf',
      content: fakePdf,
    });

    // Give the hook's 300ms debounce + extraction a chance to run. If a
    // context appears within the window, that's a failure.
    await page.waitForFunction(() => {
      const store = (window as unknown as {
        __fileContextStore?: { getState: () => { contexts: Record<string, unknown> } };
      }).__fileContextStore;
      // Resolve once the store object is available — we just need a first
      // snapshot so the assertion below can inspect it.
      return Boolean(store && store.getState());
    });

    // Poll for ~1s to catch any late-arriving extraction for the PDF, then
    // assert there still isn't one.
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const state = await readStore(page);
      if (state.contexts[path]) {
        found = true;
      } else {
        await page.waitForFunction(() => true); // yield
      }
    }
    expect(found).toBe(false);

    const toggle = page.getByTestId(`ai-context-toggle-${pathToTestId(path)}`);
    await expect(toggle).toHaveCount(0);
  });

  test('system prompt carries the extracted file text into the AI baseRole', async ({ page }) => {
    const path = '/test-workspace/fixtures/system-prompt.xlsx';
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path,
      name: 'system-prompt.xlsx',
      content: dataUrl,
    });

    await expectContextEventually(page, path, (ctx) =>
      Boolean(ctx) && ctx!.extractedText.includes('11000')
    );

    const prompt = await page.evaluate(() => {
      const fn = (window as unknown as {
        __buildSystemPromptForTest?: (base?: string) => string;
      }).__buildSystemPromptForTest;
      if (!fn) throw new Error('__buildSystemPromptForTest not available');
      return fn('You are a helpful AI assistant.');
    });

    expect(prompt).toContain('You are a helpful AI assistant.');
    expect(prompt).toContain('The user currently has these files open');
    expect(prompt).toContain('## system-prompt.xlsx');
    expect(prompt).toContain('=== Sheet: Revenue ===');
    expect(prompt).toContain('11000');

    // Toggle off — the file should drop out of the prompt entirely.
    const toggle = page.getByTestId(`ai-context-toggle-${pathToTestId(path)}`);
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await hardClick(toggle);

    const promptAfter = await page.evaluate(() => {
      const fn = (window as unknown as {
        __buildSystemPromptForTest?: (base?: string) => string;
      }).__buildSystemPromptForTest;
      return fn!('You are a helpful AI assistant.');
    });
    expect(promptAfter).not.toContain('system-prompt.xlsx');
    expect(promptAfter).not.toContain('=== Sheet: Revenue ===');
  });
});
