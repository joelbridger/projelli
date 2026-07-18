import { chromium } from 'playwright';
import { withBrowserLaunchOptions } from '../../browser-launch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, copyFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { renderCinematic, focusOn, wideCrop, type CameraShot, type Caption } from '../lib/cinematic';

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
  // Wipe any stale recordings so we don't grab an old webm later.
  rmSync(VIDEO_TMP, { recursive: true, force: true });
  mkdirSync(VIDEO_TMP, { recursive: true });
  const replay: Replay = JSON.parse(readFileSync(REPLAY_PATH, 'utf-8'));

  // 4K capture (DPR=2) for crisp text when the camera zooms in. The
  // viewport stays at 1920x1080 CSS so the React layout is unchanged.
  const browser = await chromium.launch(withBrowserLaunchOptions({
    args: ['--force-device-scale-factor=2', '--high-dpi-support=1'],
  }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    recordVideo: { dir: VIDEO_TMP, size: { width: 3840, height: 2160 } },
  });
  const page = await context.newPage();
  const recordingStartMs = Date.now();
  const elapsedSec = () => (Date.now() - recordingStartMs) / 1000;
  // Narrative beats — captured timestamps relative to recording start.
  // These drive the camera + caption timeline below.
  const beats: Record<string, number> = {};

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

  await page.goto('http://localhost:5175/?testMode=true', { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: macStyles() });
  beats.pageReady = elapsedSec();

  // ── t=0-1s: workspace hero state (editor showing Launch Plan.md, no AI tab yet) ──
  await seedState(page, linterlyFixture, 'workspaceHero');
  // Override file tree to not show Brand Voice.md yet
  await page.evaluate(
    ({ rootPath, files }) => {
      (window as any).__keepance_seed!({ workspace: { rootPath, fileTree: files } });
    },
    { rootPath, files: filesWithoutBrandVoice },
  );
  await sleep(1000);

  // ── t=1-2s: open the AI assistant tab (shows empty chat, input at bottom) ──
  await page.evaluate(
    ({ chatId, rootPath, chatFileContent, chatTitle }) => {
      (window as any).__keepance_seed!({
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
  let chatInputRect: { x: number; y: number; width: number; height: number } | null = null;
  try {
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 5000 });
    chatInputRect = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="chat-input"]') as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    beats.typingStart = elapsedSec();
    await page.click('[data-testid="chat-input"]');
    await page.keyboard.type(USER_PROMPT, { delay: 80 });
  } catch {
    // If chat-input isn't found, the AIChatViewer may render a different element
    // Fall through — we'll seed the "sent" state directly
    console.warn('chat-input not found — skipping keyboard type, seeding directly');
  }
  await sleep(300);
  beats.sendClicked = elapsedSec();

  // ── t=4s: "send" — seed the streaming state (user message + empty assistant + isLoading: true) ──
  await page.evaluate(
    ({ chatId, userPrompt, chatTitle, chatFileContent, rootPath }) => {
      const seed = (window as any).__keepance_seed!;
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
  const FILE_TREE_UPDATE_AT = 5_000; // ms from stream start — file appears partway through
  const STREAM_PACE = 5;             // multiplier on chunk delays so streaming is readable
  const streamStart = Date.now();
  let fileAdded = false;

  for (const chunk of replay.chunks) {
    await sleep(chunk.delayMs * STREAM_PACE);
    accumulated += chunk.text;

    const elapsed = Date.now() - streamStart;

    // Progressive update of the streaming message content
    await page.evaluate(
      ({ chatId, content, userPrompt }) => {
        (window as any).__keepance_seed!({
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
      beats.fileAppeared = elapsedSec();
      await page.evaluate(
        ({ rootPath, files }) => {
          (window as any).__keepance_seed!({ workspace: { rootPath, fileTree: files } });
        },
        { rootPath, files: [...filesWithoutBrandVoice, brandVoiceFile] },
      );
    }
  }

  // Mark streaming done
  await page.evaluate(
    ({ chatId, content, userPrompt }) => {
      (window as any).__keepance_seed!({
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
    beats.fileAppeared = elapsedSec();
    await page.evaluate(
      ({ rootPath, files }) => {
        (window as any).__keepance_seed!({ workspace: { rootPath, fileTree: files } });
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
        (window as any).__keepance_seed!({
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
  beats.fileOpened = elapsedSec();

  // Capture the editor rect now that Brand Voice.md is open — the
  // camera will zoom on this region for the final beat.
  const editorRect = await page.evaluate(() => {
    const el = document.querySelector('.cm-editor, [data-testid="markdown-editor"], main') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }).catch(() => null);

  await sleep(3000);

  // ── t=25-30s: hold final state ──
  await sleep(5000);
  beats.end = elapsedSec();

  await page.close();
  await context.close();
  await browser.close();

  // Find the recorded webm — pick the newest in case multiple linger.
  const webms = readdirSync(VIDEO_TMP)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, mtime: statSync(path.join(VIDEO_TMP, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (webms.length === 0) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webms[0]!.f);

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'demo-30s.mp4');

  // ── Build camera + caption timeline ──────────────────────────────────
  // Coords are in 1x post-composite space (1920x1080). The lib scales
  // them to 4K when generating the ffmpeg crop expression.
  console.log('[V01] beats:', JSON.stringify(beats));

  // Chat-area focus rect: prefer the captured chat-input rect with
  // generous vertical padding so we see the messages above. Fallback
  // to a hardcoded right-side region.
  const chatFocus = chatInputRect
    ? focusOn([{ x: chatInputRect.x, y: chatInputRect.y - 320, width: chatInputRect.width, height: chatInputRect.height + 320 }], { minWidth: 1300, pad: 24 })
    : { x: 320, y: 110, w: 1300, h: 743 };

  const editorFocus = editorRect
    ? focusOn([editorRect], { minWidth: 1300, pad: 24 })
    : chatFocus;

  // File-appears beat: pull back to a wider shot showing both file
  // tree and the chat, so the viewer can see the new file pop into
  // existence on the left while the message keeps streaming.
  const wideShowingTreeAndChat: { x: number; y: number; w: number; h: number } =
    { x: 56, y: 80, w: 1700, h: 970 };

  const shots: CameraShot[] = [
    { tSec: 0,                                  crop: wideCrop(),               label: 'wide-open' },
    { tSec: (beats.typingStart ?? 2) - 0.3,     crop: chatFocus,                 label: 'zoom-on-chat' },
    { tSec: (beats.fileAppeared ?? 14) - 0.5,   crop: wideShowingTreeAndChat,    label: 'pull-back-for-file' },
    { tSec: (beats.fileAppeared ?? 14) + 2.5,   crop: chatFocus,                 label: 'back-to-chat' },
    { tSec: (beats.fileOpened ?? 22) + 0.2,     crop: editorFocus,               label: 'zoom-on-editor' },
    { tSec: (beats.end ?? 30),                  crop: editorFocus,               label: 'hold-end' },
  ];

  const captions: Caption[] = [
    { startSec: (beats.typingStart ?? 2) + 0.1, endSec: (beats.sendClicked ?? 5) + 0.5, text: 'Type your prompt' },
    { startSec: (beats.sendClicked ?? 5) + 0.8, endSec: (beats.fileAppeared ?? 14) - 0.5, text: 'Watch Claude stream the response' },
    { startSec: (beats.fileAppeared ?? 14) + 0.2, endSec: (beats.fileAppeared ?? 14) + 4.5, text: 'A real Markdown file appears in your workspace' },
    { startSec: (beats.fileOpened ?? 22) + 0.5, endSec: Math.min((beats.end ?? 30) - 0.3, (beats.fileOpened ?? 22) + 6), text: 'Open it. Edit it. It’s yours forever.' },
  ];

  // PRE_ROLL trims the lead-in (test-workspace flash → seedState swap)
  // so the final video opens on the Linterly workspace.
  const PRE_ROLL_SEC = 0.5;
  const trimSec = Math.max(0, (beats.pageReady ?? 0.6) + 0.4 - PRE_ROLL_SEC);
  console.log(`[V01] trimming ${trimSec.toFixed(2)}s lead-in`);

  // Adjust shot/caption times so they're in trimmed-output coords too —
  // because we use OUTPUT seek, the filter sees `n` reset to 0 after
  // the trim. So subtract trimSec from every keyframe time.
  // Wait: actually we use -ss AFTER -i which doesn't reset n. Hmm.
  // Test: V09 worked without adjusting times — keyframes used webm
  // time (un-trimmed). So leave shots/captions in webm time.
  await renderCinematic({
    webmPath,
    chromePngPath: CHROME_PNG,
    outPath,
    shots,
    captions,
    trimSec,
  videoTitle: 'Watch an AI chat become a real file',
  });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'demo-30s.mp4'));
  console.log(`✓ press-kit copy → ${path.join(PRESS_KIT_DIR, 'demo-30s.mp4')}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video01().catch((e) => { console.error(e); process.exit(1); });
}
