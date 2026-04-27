import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, readFileSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video');
const REPLAY_PATH = path.resolve(HERE, '../fixtures/ai-replays/launch-plan-stream.json');

interface ReplayChunk { delayMs: number; text: string; }
interface Replay { chunks: ReplayChunk[]; createdFile?: string; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const CHAT_ID = 'ai-stream-session';
const USER_PROMPT = 'Draft a brand voice doc based on Vision.md and Customers.md.';
const CHAT_TITLE = 'Drafting brand voice for Linterly';

export async function video01() {
  mkdirSync(VIDEO_TMP, { recursive: true });
  const replay: Replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf-8'));

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_TMP, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();

  const rootPath = linterlyFixture.rootPath;
  const chatFileContent = JSON.stringify({
    id: CHAT_ID,
    title: CHAT_TITLE,
    created: new Date(2026, 3, 27).toISOString(),
    updated: new Date(2026, 3, 27).toISOString(),
    messages: [],
    provider: 'anthropic',
    model: 'claude-opus-4-7',
  });

  // Build file tree without Brand Voice.md (it will "appear" at t=14s during streaming)
  const filesWithoutBrandVoice = linterlyFixture.files.filter((f) => f.name !== 'Brand Voice.md');
  const brandVoiceFile = linterlyFixture.files.find((f) => f.name === 'Brand Voice.md')!;

  await page.goto('http://localhost:5173/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });

  // ── t=0-1s: workspace hero state (editor showing Launch Plan.md, no AI tab yet) ──
  await seedState(page, linterlyFixture, 'workspaceHero');
  // Override file tree to not show Brand Voice.md yet
  await page.evaluate(
    ({ rootPath, files }) => {
      (window as any).__projelli_seed!({ workspace: { rootPath, fileTree: files } });
    },
    { rootPath, files: filesWithoutBrandVoice },
  );
  await sleep(1000);

  // ── t=1-2s: open the AI assistant tab (shows empty chat, input at bottom) ──
  await page.evaluate(
    ({ chatId, rootPath, chatFileContent, chatTitle }) => {
      (window as any).__projelli_seed!({
        editor: {
          openTabs: [
            {
              path: `${rootPath}/Launch Plan.md`,
              name: 'Launch Plan.md',
              content: '',
              isDirty: false,
              type: 'file',
            },
            {
              path: chatId,
              name: chatTitle,
              content: chatFileContent,
              isDirty: false,
              type: 'ai-assistant',
            },
          ],
          activeTabPath: chatId,
          showBacklinks: false,
        },
        aiChat: {
          sessions: {
            [chatId]: {
              chatId,
              messages: [],
              isLoading: false,
              lastUpdated: new Date(2026, 3, 27, 14, 21).toISOString(),
            },
          },
        },
      });
    },
    { chatId: CHAT_ID, rootPath, chatFileContent, chatTitle: CHAT_TITLE },
  );
  await sleep(1000);

  // ── t=2-4s: type the prompt char-by-char into the chat input ──
  // Wait for the chat input to appear (it's rendered inside AIChatViewer)
  try {
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 5000 });
    await page.click('[data-testid="chat-input"]');
    await page.keyboard.type(USER_PROMPT, { delay: 80 });
  } catch {
    // If chat-input isn't found, the AIChatViewer may render a different element
    // Fall through — we'll seed the "sent" state directly
    console.warn('chat-input not found — skipping keyboard type, seeding directly');
  }
  await sleep(300);

  // ── t=4s: "send" — seed the streaming state (user message + empty assistant + isLoading: true) ──
  await page.evaluate(
    ({ chatId, userPrompt, chatTitle, chatFileContent, rootPath }) => {
      const seed = (window as any).__projelli_seed!;
      const ts = new Date(2026, 3, 27, 14, 22).toISOString();
      // Update the chat file content to reflect the updated state
      const updatedChatContent = JSON.stringify({
        id: chatId,
        title: chatTitle,
        created: new Date(2026, 3, 27).toISOString(),
        updated: ts,
        messages: [
          { role: 'user', content: userPrompt, timestamp: ts },
        ],
        provider: 'anthropic',
        model: 'claude-opus-4-7',
      });
      seed({
        editor: {
          openTabs: [
            {
              path: `${rootPath}/Launch Plan.md`,
              name: 'Launch Plan.md',
              content: '',
              isDirty: false,
              type: 'file',
            },
            {
              path: chatId,
              name: chatTitle,
              content: updatedChatContent,
              isDirty: false,
              type: 'ai-assistant',
            },
          ],
          activeTabPath: chatId,
          showBacklinks: false,
        },
        aiChat: {
          sessions: {
            [chatId]: {
              chatId,
              messages: [
                {
                  role: 'user',
                  content: userPrompt,
                  timestamp: ts,
                },
                {
                  role: 'assistant',
                  content: '',
                  timestamp: new Date(2026, 3, 27, 14, 22, 1).toISOString(),
                },
              ],
              isLoading: true,
              lastUpdated: new Date(2026, 3, 27, 14, 22, 1).toISOString(),
            },
          },
        },
      });
    },
    { chatId: CHAT_ID, userPrompt: USER_PROMPT, chatTitle: CHAT_TITLE, chatFileContent, rootPath },
  );

  // ── t=4-22s: stream assistant response progressively ──
  let accumulated = '';
  const FILE_TREE_UPDATE_AT = 14_000; // ms from stream start
  const streamStart = Date.now();
  let fileAdded = false;

  for (const chunk of replay.chunks) {
    await sleep(chunk.delayMs);
    accumulated += chunk.text;

    const elapsed = Date.now() - streamStart;

    // Progressive update of the streaming message content
    await page.evaluate(
      ({ chatId, content, userPrompt }) => {
        (window as any).__projelli_seed!({
          aiChat: {
            sessions: {
              [chatId]: {
                chatId,
                messages: [
                  {
                    role: 'user',
                    content: userPrompt,
                    timestamp: new Date(2026, 3, 27, 14, 22).toISOString(),
                  },
                  {
                    role: 'assistant',
                    content,
                    timestamp: new Date(2026, 3, 27, 14, 22, 1).toISOString(),
                  },
                ],
                isLoading: true,
                lastUpdated: new Date(2026, 3, 27, 14, 22, 1).toISOString(),
              },
            },
          },
        });
      },
      { chatId: CHAT_ID, content: accumulated, userPrompt: USER_PROMPT },
    );

    // At ~14s, add Brand Voice.md to the file tree
    if (!fileAdded && elapsed > FILE_TREE_UPDATE_AT) {
      fileAdded = true;
      await page.evaluate(
        ({ rootPath, files }) => {
          (window as any).__projelli_seed!({ workspace: { rootPath, fileTree: files } });
        },
        { rootPath, files: [...filesWithoutBrandVoice, brandVoiceFile] },
      );
    }
  }

  // Mark streaming done
  await page.evaluate(
    ({ chatId, content, userPrompt }) => {
      (window as any).__projelli_seed!({
        aiChat: {
          sessions: {
            [chatId]: {
              chatId,
              messages: [
                {
                  role: 'user',
                  content: userPrompt,
                  timestamp: new Date(2026, 3, 27, 14, 22).toISOString(),
                },
                {
                  role: 'assistant',
                  content,
                  timestamp: new Date(2026, 3, 27, 14, 22, 5).toISOString(),
                },
              ],
              isLoading: false,
              lastUpdated: new Date(2026, 3, 27, 14, 22, 5).toISOString(),
            },
          },
        },
      });
    },
    { chatId: CHAT_ID, content: accumulated, userPrompt: USER_PROMPT },
  );

  // Ensure Brand Voice.md is in the tree regardless of timing
  if (!fileAdded) {
    await page.evaluate(
      ({ rootPath, files }) => {
        (window as any).__projelli_seed!({ workspace: { rootPath, fileTree: files } });
      },
      { rootPath, files: [...filesWithoutBrandVoice, brandVoiceFile] },
    );
  }

  // Pad to 10s total stream time (after 4.7s typing+send overhead → ~22s elapsed total)
  const streamElapsed = Date.now() - streamStart;
  await sleep(Math.max(0, 10_000 - streamElapsed));

  // ── t=22-25s: open Brand Voice.md ──
  // Try clicking it in the file tree, fall back to seeding the editor
  const clicked = await page
    .locator('[data-testid="file-tree-item"]')
    .filter({ hasText: 'Brand Voice.md' })
    .first()
    .click({ timeout: 2000 })
    .then(() => true)
    .catch(() => false);

  if (!clicked) {
    // Fallback: seed Brand Voice.md as the active editor tab
    await page.evaluate(
      ({ chatId, rootPath, brandVoiceContent, brandVoicePath, chatTitle, chatFileContent }) => {
        (window as any).__projelli_seed!({
          editor: {
            openTabs: [
              {
                path: chatId,
                name: chatTitle,
                content: chatFileContent,
                isDirty: false,
                type: 'ai-assistant',
              },
              {
                path: brandVoicePath,
                name: 'Brand Voice.md',
                content: brandVoiceContent,
                isDirty: false,
                type: 'file',
              },
            ],
            activeTabPath: brandVoicePath,
            showBacklinks: false,
          },
          workspace: { selectedPath: brandVoicePath },
        });
      },
      {
        chatId: CHAT_ID,
        rootPath,
        brandVoiceContent: linterlyFixture.fileContents['Brand Voice.md'] ?? '',
        brandVoicePath: brandVoiceFile.path,
        chatTitle: CHAT_TITLE,
        chatFileContent,
      },
    );
  }
  await sleep(3000);

  // ── t=25-30s: hold final state ──
  await sleep(5000);

  await page.close();
  await context.close();
  await browser.close();

  // Find the recorded webm
  const webm = readdirSync(VIDEO_TMP).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webm);

  // Compose chrome overlay via ffmpeg (no shell — array args only)
  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'demo-30s.mp4');

  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i', webmPath,
      '-i', CHROME_PNG,
      '-filter_complex',
      // 1) Scale video content to the chrome's inner content area (1808x1004)
      // 2) Pad to 1920x1080 canvas, content starts at x=56 y=52 (24px top margin + 28px titlebar)
      // 3) Overlay the chrome frame (with alpha) on top of the positioned content
      '[0:v]scale=1808:1004[scaled];' +
      '[scaled]pad=1920:1080:56:52:color=0x1a1a1a[padded];' +
      '[1:v]format=rgba[chrome];' +
      '[padded][chrome]overlay=0:0,format=yuv420p[v]',
      '-map', '[v]',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-r', '30',
      outPath,
    ],
    { stdio: 'inherit' },
  );

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'demo-30s.mp4'));
  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video01().catch((e) => { console.error(e); process.exit(1); });
}
