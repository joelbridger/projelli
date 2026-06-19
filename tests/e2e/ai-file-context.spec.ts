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

import { waitForTestModeLoad, openAIAssistantPane } from './helpers/test-utils';

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

  test('current chat surface shows the open file context indicator', async ({ page }) => {
    const path = '/test-workspace/Client A/context.xlsx';
    const dataUrl = readFixtureAsDataUrl('test.xlsx', MIME.xlsx);
    await openFixtureTab(page, {
      path,
      name: 'context.xlsx',
      content: dataUrl,
    });

    await expectContextEventually(page, path, (ctx) => Boolean(ctx));
    await openAIAssistantPane(page);

    await expect(page.getByTestId('ai-context-indicator')).toBeVisible();
    await expect(page.getByTestId('ai-context-file-list')).toContainText('AI can see');
    const contextCount = await page.getByTestId('ai-context-indicator').getAttribute('data-context-count');
    expect(Number(contextCount)).toBeGreaterThan(0);
  });

  test('unsupported file types do not produce a context', async ({ page }) => {
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

    // The old per-file chip was removed from the 3.0 UI, but the existing
    // persisted opt-out store still controls whether a file reaches the prompt.
    await page.evaluate((p) => {
      const store = (window as unknown as {
        __fileContextStore?: {
          getState: () => {
            togglePath: (path: string) => void;
          };
        };
      }).__fileContextStore;
      store!.getState().togglePath(p);
    }, path);

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
