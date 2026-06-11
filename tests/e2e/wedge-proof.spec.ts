/**
 * VG-1 LEG 2 — wedge UI WIRING in the browser build (testMode).
 *
 * HONESTY BOUNDARY: browser mode has no Rust rag (`ragRetrieve` throws
 * "RAG is only available in the desktop app", tauri-commands.ts:315). This
 * spec therefore proves UI GLUE only:
 *   1. Citation chips (verified + unverified render states), the sources
 *      accordion, the per-message matter-scope chip, and citation
 *      click-through opening the right FILE — over SEEDED messages carrying
 *      real fixture text. (Render truth, not retrieval truth.) The
 *      passage-level half of click-through is a recorded product finding:
 *      see the expected-fail test below (scroll-to-paragraph has no
 *      listener), kept at full assertion strength as the fix tripwire.
 *   2. The F-116 refusal: "Ask my workspace" ON in a build without rag
 *      REFUSES instead of fabricating (the live send path up to the refusal
 *      runs for real; it returns before any provider/API-key code).
 *   3. The xlsx open → edit → recompute → save-artifact → reopen round-trip
 *      over the campaign's damages-model.xlsx, asserting the FORMULA
 *      survives (=SUM(B2:B7) is not flattened to a number). Formerly the
 *      F-506 expected-fail tripwire (SheetJS dropped formula cells whose
 *      cached value is empty, so openpyxl-authored totals neither rendered
 *      nor survived a save); fixed in the Wave 1 fix wave (`sheetStubs:
 *      true` + stub handling in spreadsheet-io.ts) and now a normal test at
 *      full assertion strength.
 *   4. exhibit-deck.pptx parses and renders its real slide text through the
 *      honest no-LibreOffice fallback outline. (There is NO pptx editing in
 *      the product — the export side is unit-covered in pptx-export.test.ts.)
 *
 * Retrieval truth lives in src-tauri/tests/rag_deposition_contradictions.rs
 * (leg 1); the real-machine pass is scripts/wedge-proof-native.sh (leg 3).
 *
 * Run: npx playwright test tests/e2e/wedge-proof.spec.ts --project=chromium
 * Keep screenshots: WEDGE_KEEP_SHOTS=1 npx playwright test ...
 */

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect, type Page, type TestInfo } from '@playwright/test';

import { collectConsoleErrors } from '../campaign/helpers/campaign';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures', 'matter-corpus');
const KEEP_DIR = join(
  here,
  '..',
  '..',
  'docs',
  'quality',
  '2026-06-11-wedge-proof',
  'screenshots',
  'browser',
);

/** snap()-alike that banks into the wedge-proof artifact dir when
 *  WEDGE_KEEP_SHOTS=1 (the campaign snap() is hardwired to the 2026-06-10
 *  campaign folder, so leg 2 keeps its own). */
async function keep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const out = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: out, fullPage: true });
  await testInfo.attach(name, { path: out, contentType: 'image/png' });
  if (process.env.WEDGE_KEEP_SHOTS === '1') {
    mkdirSync(KEEP_DIR, { recursive: true });
    copyFileSync(out, join(KEEP_DIR, `${name}.png`));
  }
}

async function openTestFile(
  page: Page,
  args: { path: string; name: string; content: string },
) {
  await page.evaluate((a) => {
    const fn = (
      window as unknown as { __openTestFile?: (p: string, n: string, c: string) => void }
    ).__openTestFile;
    if (!fn) throw new Error('window.__openTestFile missing — is testMode=true?');
    fn(a.path, a.name, a.content);
  }, args);
}

/** Seed a text file into the in-memory mock workspace fs WITHOUT opening a
 *  tab (so citation click-through exercises the real open-from-fs path). */
async function seedMockTextFile(page: Page, path: string, content: string) {
  await page.evaluate(
    ({ p, c }) => {
      const fs = (
        window as unknown as {
          __mockWorkspaceFs?: { seed: (p: string, bytes: ArrayBuffer) => void };
        }
      ).__mockWorkspaceFs;
      if (!fs) throw new Error('window.__mockWorkspaceFs missing — is testMode=true?');
      const bytes = new TextEncoder().encode(c);
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      fs.seed(p, copy);
    },
    { p: path, c: content },
  );
}

const DEPO_PATH = '/test-workspace/matter-corpus/deposition-transcript-johnson.txt';
const SUMMARY_PATH = '/test-workspace/matter-corpus/incident-summary-johnson.md';

const depoText = readFileSync(join(fixturesDir, 'deposition-transcript-johnson.txt'), 'utf8');
const summaryText = readFileSync(join(fixturesDir, 'incident-summary-johnson.md'), 'utf8');

/** A persisted chat whose assistant turn carries citations + sources +
 *  matter scope — the exact shapes AIChatViewer renders (ChatMessage.sources,
 *  ai.ts:51; TurnScope, ai.ts:64; chips parse `[file paragraph N]`,
 *  workspaceCommand.ts:156). One source verified, one NOT verified, so both
 *  chip render states are asserted. */
function citedChatFile(): string {
  return JSON.stringify({
    provider: 'mock',
    model: 'mock-model',
    createdAt: new Date().toISOString(),
    messages: [
      {
        role: 'user',
        content: 'What deadline was Johnson given for his written response?',
        timestamp: new Date().toISOString(),
      },
      {
        role: 'assistant',
        content:
          'The record conflicts. The deposition records October 17, 2025 ' +
          '[deposition-transcript-johnson.txt paragraph 12], while the incident ' +
          'summary records October 10, 2025 [incident-summary-johnson.md paragraph 8].',
        timestamp: new Date().toISOString(),
        scope: {
          kind: 'matter',
          matterId: 'matter-johnson',
          matterName: 'Johnson v. Nexus Dynamics Corp.',
        },
        sources: [
          {
            path: DEPO_PATH,
            chunkText: 'He said I had until October 17, 2025 to submit my written response.',
            score: 0.92,
            paragraphIndex: 12,
            id: 'a'.repeat(64),
            matterId: 'matter-johnson',
            sourceId: DEPO_PATH,
            verified: true,
          },
          {
            path: SUMMARY_PATH,
            chunkText: 'a deadline of October 10, 2025 to submit his written explanation',
            score: 0.9,
            paragraphIndex: 8,
            id: 'b'.repeat(64),
            matterId: 'matter-johnson',
            sourceId: SUMMARY_PATH,
            verified: false,
          },
        ],
      },
    ],
  });
}

/** Seed both fixture files + the cited chat and return the inline chip
 *  locators.
 *
 *  NOTE (selector corrected to match the UI, plan discipline): the sources
 *  accordion's expanded rows REUSE the chip testid
 *  (`chat-citation-${base}-${paragraphIndex}`, AIChatViewer.tsx:409), so once
 *  the accordion is open a bare getByTestId resolves to TWO elements and
 *  strict mode rejects it. Only the INLINE message chips carry the
 *  data-verified attribute (AIChatViewer.tsx:312-318) — scope on it so every
 *  assertion (and click-through) targets the inline chip. */
async function openCitedChat(page: Page) {
  await seedMockTextFile(page, DEPO_PATH, depoText);
  await seedMockTextFile(page, SUMMARY_PATH, summaryText);
  await openTestFile(page, {
    path: '/test-workspace/AI Chats/wedge-cited.aichat',
    name: 'wedge-cited.aichat',
    content: citedChatFile(),
  });
  return {
    verifiedChip: page.locator(
      '[data-testid="chat-citation-deposition-transcript-johnson.txt-12"][data-verified]',
    ),
    unverifiedChip: page.locator(
      '[data-testid="chat-citation-incident-summary-johnson.md-8"][data-verified]',
    ),
  };
}

test.describe('VG-1 leg 2 — wedge UI wiring (browser, testMode)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('cited answer renders chips (verified + unverified), sources accordion, scope chip; chip click opens the cited file', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    const { verifiedChip, unverifiedChip } = await openCitedChat(page);

    // Chips — one per citation, carrying the verify render state.
    await expect(verifiedChip).toBeVisible();
    await expect(verifiedChip).toHaveAttribute('data-verified', 'true');
    await expect(unverifiedChip).toBeVisible();
    await expect(unverifiedChip).toHaveAttribute('data-verified', 'false');

    // Per-message matter-scope chip.
    const scopeChip = page.getByTestId('chat-message-1-scope');
    await expect(scopeChip).toBeVisible();
    await expect(scopeChip).toHaveAttribute('data-scope-kind', 'matter');

    // Sources accordion lists both sources.
    const accordion = page.getByTestId('chat-sources-accordion');
    await expect(accordion).toBeVisible();
    await hardClick(page.getByTestId('chat-sources-toggle'));
    await expect(accordion).toContainText('deposition-transcript-johnson.txt');
    await expect(accordion).toContainText('incident-summary-johnson.md');
    await keep(page, testInfo, 'leg2-01-cited-answer');

    // Click-through: the chip opens the REAL seeded fixture file — its
    // genuine content (read back through the mock-fs open path, not the chat)
    // is on screen. The top-of-transcript caption can only come from the
    // seeded fixture bytes.
    await hardClick(verifiedChip);
    await expect(
      page.getByText('IN THE UNITED STATES DISTRICT COURT'),
    ).toBeVisible({ timeout: 10_000 });
    await keep(page, testInfo, 'leg2-02-citation-clickthrough');

    expect(getErrors(), 'console errors').toHaveLength(0);
  });

  test('FINDING (expected fail): citation click-through does NOT scroll to the cited passage', async ({
    page,
  }, testInfo) => {
    // PRODUCT FINDING — harness proves, never fixes (F-5xx row for the
    // RESULTS.md ledger, Task 7): clicking a citation opens the right file
    // but never navigates to the cited paragraph. App.tsx:3518-3536
    // dispatches `keepance:scroll-to-paragraph` with the paragraph index,
    // but NO editor subscribes to it (grep: the dispatch site is the only
    // occurrence in src/; the inline comment says the editor integration
    // "can land later"). The file opens at the top, and CodeMirror's
    // virtualized viewport never mounts the passage at fixture line 108 —
    // so the wedge promise "click-through opens the source PASSAGE"
    // currently delivers only "opens the source FILE". Same code path runs
    // under Tauri, so leg 3 will observe the same gap.
    //
    // The assertion below is the plan's original, at full strength. When the
    // scroll listener lands, this test will "pass unexpectedly" and fail the
    // suite — remove the test.fail() and fold the assertion into the
    // click-through test above.
    test.fail(
      true,
      'Known product gap: keepance:scroll-to-paragraph has no listener; cited passage not brought on screen',
    );

    const { verifiedChip } = await openCitedChat(page);
    await expect(verifiedChip).toBeVisible();
    await hardClick(verifiedChip);
    await keep(page, testInfo, 'leg2-02b-passage-not-scrolled');
    await expect(
      page.getByText('until October 17, 2025 to submit my written response').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('ask-workspace ON in a build without rag REFUSES instead of fabricating; privilege toggle appears', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    await openTestFile(page, {
      path: '/test-workspace/AI Chats/wedge-refusal.aichat',
      name: 'wedge-refusal.aichat',
      content: JSON.stringify({
        provider: 'mock',
        model: 'mock-model',
        messages: [],
        createdAt: new Date().toISOString(),
      }),
    });

    // Turn on "Ask my workspace" — the include-privileged toggle is glued to it.
    await hardClick(page.getByTestId('ask-workspace-toggle'));
    await expect(page.getByTestId('include-privileged-toggle')).toBeVisible();

    const input = page.getByTestId('chat-input');
    await expect(input).toBeVisible();
    await input.fill('What deadline was Johnson given for his written response?');
    await hardClick(page.getByTestId('chat-send-button'));

    // The live refusal path (AIChatViewer.tsx:1025-1056) posts the refusal
    // and returns BEFORE any provider code — exact copy from en.json:484.
    await expect(
      page.getByText(
        "I couldn't search your workspace just now, so I won't answer from your matter.",
        { exact: false },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await keep(page, testInfo, 'leg2-03-refusal');

    // The ONLY expected console error is the retrieval failure log itself
    // (AIChatViewer.tsx:1005). Anything else fails the test.
    const unexpected = getErrors().filter((e) => !e.includes('Workspace retrieval failed'));
    expect(unexpected, 'unexpected console errors').toHaveLength(0);
  });

  const XLSX_MIME =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const PPTX_MIME =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function fixtureAsDataUrl(name: string, mime: string): string {
    const bytes = readFileSync(join(fixturesDir, name));
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  }

  test('xlsx round-trip: openpyxl formula cells render, recompute, and survive edit + save (F-506 fixed)', async ({
    page,
  }, testInfo) => {
    // F-506 — FIXED in the Wave 1 fix wave: `sheetStubs: true` + stub-cell
    // handling in spreadsheet-io.ts. openpyxl never computes formulas; the
    // fixture stores `<c r="B10"><f>SUM(B2:B7)</f><v></v></c>`, and the old
    // read options (no `sheetStubs`) made SheetJS DROP that cell — the TOTAL
    // cells painted empty and any edit+autosave silently stripped the
    // formulas from the saved file. Now the stub surfaces as
    // `{t:'z', f:'SUM(B2:B7)'}`, `cellToSheetCell` keeps formula-bearing
    // stubs (and still drops blank ones), `hasFormulas` trips, and the
    // existing SheetEngine overlay computes the totals live. Unit coverage:
    // tests/unit/spreadsheet-io.test.ts (F-506 describe block). This test is
    // the plan's original round-trip at full assertion strength — formerly
    // the expected-fail tripwire, now a normal test.

    const getErrors = collectConsoleErrors(page);
    const xlsxPath = '/test-workspace/matter-corpus/damages-model.xlsx';

    await openTestFile(page, {
      path: xlsxPath,
      name: 'damages-model.xlsx',
      content: fixtureAsDataUrl('damages-model.xlsx', XLSX_MIME),
    });
    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Layout (generate-fixtures.py:726-749, 0-based incl. header row):
    // B4 "Lost bonus (2025)" = cell-3-1 (22000); B10 "TOTAL (base)" =
    // cell-9-1 = =SUM(B2:B7) → 355250 computed by the live formula engine.
    const total = page.getByTestId('spreadsheet-cell-9-1');
    await expect(total).toContainText('355250');

    // Edit the input: 22000 → 30000; the total recomputes to 363250.
    const bonus = page.getByTestId('spreadsheet-cell-3-1');
    await bonus.dblclick();
    const editor = page.getByTestId('spreadsheet-cell-input-3-1');
    await expect(editor).toBeVisible();
    await editor.fill('30000');
    await editor.press('Enter');
    await expect(total).toContainText('363250');
    await keep(page, testInfo, 'leg2-04-xlsx-edited');

    // The edit pushed a re-serialized .xlsx data URL into the tab content
    // (SpreadsheetViewer onContentChange → editor store). Read that saved
    // artifact back and REOPEN it — the true serialize→reparse round-trip.
    const savedDataUrl = await page.evaluate((p) => {
      const store = (
        window as unknown as {
          __editorStore?: { getState: () => { openTabs: Array<{ path: string; content: string }> } };
        }
      ).__editorStore;
      if (!store) throw new Error('window.__editorStore missing');
      const tab = store.getState().openTabs.find((t) => t.path === p);
      if (!tab) throw new Error(`tab not found: ${p}`);
      return tab.content;
    }, xlsxPath);
    expect(savedDataUrl.startsWith('data:')).toBe(true);

    await openTestFile(page, {
      path: '/test-workspace/matter-corpus/damages-model-reopened.xlsx',
      name: 'damages-model-reopened.xlsx',
      content: savedDataUrl,
    });
    await expect(page.getByTestId('spreadsheet-viewer')).toBeVisible({ timeout: 20_000 });

    // Edited value persisted AND the total still COMPUTES (not a flattened
    // copy of the old number).
    await expect(page.getByTestId('spreadsheet-cell-3-1')).toContainText('30000');
    const reopenedTotal = page.getByTestId('spreadsheet-cell-9-1');
    await expect(reopenedTotal).toContainText('363250');

    // THE formula assertion: select the total cell; the formula bar shows
    // the live formula, proving =SUM(B2:B7) survived the round-trip.
    await hardClick(reopenedTotal);
    await expect(page.getByTestId('spreadsheet-formula-bar-content')).toContainText('=SUM(B2:B7)');
    await keep(page, testInfo, 'leg2-05-xlsx-reopened-formula');

    expect(getErrors(), 'console errors').toHaveLength(0);
  });

  test('pptx: exhibit-deck.pptx parses and renders its real slide text via the honest fallback outline', async ({
    page,
  }, testInfo) => {
    const getErrors = collectConsoleErrors(page);

    await openTestFile(page, {
      path: '/test-workspace/matter-corpus/exhibit-deck.pptx',
      name: 'exhibit-deck.pptx',
      content: fixtureAsDataUrl('exhibit-deck.pptx', PPTX_MIME),
    });

    await expect(page.getByTestId('presentation-viewer')).toBeVisible({ timeout: 20_000 });
    // Browser mode takes the pure-JS extract fallback (PresentationViewer
    // effect: !inTauri → runFallback). Real fixture text, really parsed:
    await expect(page.getByTestId('presentation-fallback-banner')).toBeVisible();
    await expect(page.getByTestId('fallback-slide-1')).toContainText(
      'Johnson v. Nexus Dynamics Corp.',
    );
    await expect(page.getByTestId('fallback-slide-2')).toContainText('Key Events Timeline');
    await expect(page.getByTestId('fallback-slide-2')).toContainText(
      'November 12, 2025: Termination',
    );
    await keep(page, testInfo, 'leg2-06-pptx-fallback');

    // No pptx editing exists in the product; the export half (build→extract)
    // is unit-proven in tests/unit/pptx-export.test.ts. Nothing more to claim.
    expect(getErrors(), 'console errors').toHaveLength(0);
  });
});
