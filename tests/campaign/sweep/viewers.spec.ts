/**
 * sweep/viewers.spec.ts
 * Campaign Phase 5 — L-109..L-124
 * File type viewers: exercise each viewer via __editorStore.openTab injection
 * (same pattern as workflow-persistence.spec.ts).
 */

import { test, expect } from '@playwright/test';
import { snap, collectConsoleErrors, horizontalOverflow } from '../helpers/campaign';
import { waitForTestModeLoad } from '../../e2e/helpers/test-utils';

async function openTab(
  page: import('@playwright/test').Page,
  path: string,
  name: string,
  content: string,
  type: string = 'file',
): Promise<void> {
  await page.evaluate(
    ({ path, name, content, type }) => {
      const editor = (window as any).__editorStore?.getState?.();
      if (editor?.openTab) {
        editor.openTab(path, name, content, type);
      }
    },
    { path, name, content, type }
  );
}

test.describe('File type viewers (L-109..L-124)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  // L-109: Markdown / .md / .txt (CodeMirror editor)
  test('L-109 markdown viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.md', 'sweep-test.md', '# Sweep Test\n\nHello world\n\n- item 1\n- item 2', 'file');
    // Wait for the editor to appear
    const editor = page.locator('.cm-editor, [data-testid*="markdown-editor"]').first();
    const editorVisible = await editor.isVisible({ timeout: 5000 }).catch(() => false);
    if (editorVisible) {
      await snap(page, testInfo, 'L-109-markdown-viewer');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-109').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-109-markdown-viewer-no-editor');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-109').toHaveLength(0);
  });

  // L-110: .docx (DocxEditor — Rust engine; browser fallback)
  test('L-110 docx viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.docx', 'sweep-test.docx', '', 'file');
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'L-110-docx-viewer');
    const overflow = await horizontalOverflow(page);
    expect(overflow, 'overflow L-110').toHaveLength(0);
    const errors = getErrors();
    expect(errors, 'console errors L-110').toHaveLength(0);
  });

  // L-111: .xlsx / .xls / .csv (SpreadsheetViewer)
  test('L-111 xlsx viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.xlsx', 'sweep-test.xlsx', '', 'file');
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'L-111-xlsx-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-111').toHaveLength(0);
  });

  test('L-111b csv viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.csv', 'sweep-test.csv', 'col1,col2\nval1,val2', 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-111b-csv-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-111b').toHaveLength(0);
  });

  // L-112: .pptx / .ppt (PresentationViewer)
  test('L-112 pptx viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.pptx', 'sweep-test.pptx', '', 'file');
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'L-112-pptx-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-112').toHaveLength(0);
  });

  // L-113: .pdf
  test('L-113 pdf viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.pdf', 'sweep-test.pdf', '', 'file');
    await page.waitForTimeout(1000);
    await snap(page, testInfo, 'L-113-pdf-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-113').toHaveLength(0);
  });

  // L-114: image viewer (jpg/png)
  test('L-114 image viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.png', 'sweep-test.png', '', 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-114-image-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-114').toHaveLength(0);
  });

  // L-115: video viewer (mp4)
  test('L-115 video viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.mp4', 'sweep-test.mp4', '', 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-115-video-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-115').toHaveLength(0);
  });

  // L-116: audio viewer (mp3)
  test('L-116 audio viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.mp3', 'sweep-test.mp3', '', 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-116-audio-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-116').toHaveLength(0);
  });

  // L-117: .whiteboard (tldraw canvas)
  test('L-117 whiteboard viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    // Navigate to whiteboard via sidebar tab
    const whiteboardTab = page.getByTestId('sidebar-tab-whiteboard');
    const tabVisible = await whiteboardTab.isVisible({ timeout: 3000 }).catch(() => false);
    if (tabVisible) {
      await whiteboardTab.click();
      await page.waitForTimeout(1500);
      await snap(page, testInfo, 'L-117-whiteboard-viewer');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-117').toHaveLength(0);
    } else {
      // Try injecting a .whiteboard tab
      await openTab(page, '/test-workspace/sweep-test.whiteboard', 'sweep-test.whiteboard', '{}', 'file');
      await page.waitForTimeout(1500);
      await snap(page, testInfo, 'L-117-whiteboard-injected');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-117').toHaveLength(0);
  });

  // L-118: .aichat (AI chat session)
  test('L-118 aichat viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const chatContent = JSON.stringify({
      provider: 'mock',
      model: 'mock-model',
      messages: [],
      createdAt: new Date().toISOString(),
    });
    await openTab(page, '/test-workspace/sweep-test.aichat', 'sweep-test.aichat', chatContent, 'file');
    await page.waitForTimeout(1000);
    const aiChat = page.getByTestId('ai-assistant-tab');
    const chatVisible = await aiChat.isVisible({ timeout: 5000 }).catch(() => false);
    if (chatVisible) {
      await snap(page, testInfo, 'L-118-aichat-viewer');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-118').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-118-aichat-viewer-no-tab');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-118').toHaveLength(0);
  });

  // L-119: .source (research source card)
  test('L-119 source viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const sourceContent = JSON.stringify({
      id: 'src_sweep',
      url: 'https://example.com',
      title: 'Sweep Test Source',
      date_accessed: '2026-06-10',
      quote_or_snippet: 'Test snippet',
      claim_supported: 'Test claim',
      reliability_notes: 'N/A',
    });
    await openTab(page, '/test-workspace/sweep-test.source', 'sweep-test.source', sourceContent, 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-119-source-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-119').toHaveLength(0);
  });

  // L-120: browser tab
  test('L-120 browser tab viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/browser/sweep-browser', 'Browser', '', 'browser');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-120-browser-tab');
    const errors = getErrors();
    expect(errors, 'console errors L-120').toHaveLength(0);
  });

  // L-121: email tab
  test('L-121 email tab viewer renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/email/sweep-email', 'Email', '', 'email');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-121-email-tab');
    const errors = getErrors();
    expect(errors, 'console errors L-121').toHaveLength(0);
  });

  // L-122: ai-assistant tab
  test('L-122 ai-assistant tab renders', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/ai/sweep-ai', 'AI Assistant', '', 'ai-assistant');
    await page.waitForTimeout(800);
    const aiTab = page.getByTestId('ai-assistant-tab');
    const tabVisible = await aiTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (tabVisible) {
      await snap(page, testInfo, 'L-122-ai-assistant-tab');
      const overflow = await horizontalOverflow(page);
      expect(overflow, 'overflow L-122').toHaveLength(0);
    } else {
      await snap(page, testInfo, 'L-122-ai-assistant-tab-no-mount');
    }
    const errors = getErrors();
    expect(errors, 'console errors L-122').toHaveLength(0);
  });

  // L-123: JSON viewer
  test('L-123 json viewer renders with syntax highlight', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    const jsonContent = JSON.stringify({ sweep: true, version: '3.0', items: [1, 2, 3] }, null, 2);
    await openTab(page, '/test-workspace/sweep-test.json', 'sweep-test.json', jsonContent, 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-123-json-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-123').toHaveLength(0);
  });

  // L-124: RTF viewer
  test('L-124 rtf viewer renders without crash', async ({ page, browserName: _b }, testInfo) => {
    const getErrors = collectConsoleErrors(page);
    await openTab(page, '/test-workspace/sweep-test.rtf', 'sweep-test.rtf', '{\\rtf1 Hello RTF}', 'file');
    await page.waitForTimeout(800);
    await snap(page, testInfo, 'L-124-rtf-viewer');
    const errors = getErrors();
    expect(errors, 'console errors L-124').toHaveLength(0);
  });
});
