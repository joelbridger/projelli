# Projelli Marketing Asset Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Playwright-driven pipeline that produces 11 macOS-styled product screenshots and a 30-second deterministic demo video for Projelli, runnable with one command on this Linux server.

**Architecture:** A self-contained Node project at `~/projelli/scripts/marketing-capture/` that drives `npm run dev` (the Vite-served React app) via headless Chromium. Each shot seeds Zustand stores with a "Linterly" fixture, injects a macOS CSS overlay, intercepts AI fetch calls with canned SSE replays, takes a 2x-DPI screenshot, and composites a macOS Sequoia window frame around it.

**Tech Stack:** Playwright (already in deps), `sharp` for image compositing, `tsx` for direct TS execution, `ffmpeg` for video post-processing, Apple SF Pro + SF Mono fonts.

**Spec:** `docs/marketing/asset-capture/SPEC.md`

**Subprocess safety:** Every step that shells out from inside the capture project uses `execFileSync` / `execFile` (or Playwright APIs) with **array arguments and no shell interpretation**. Never call `execSync` with a composed string. This matches the project's `src/utils/execFileNoThrow.ts` convention.

---

## Pre-flight

Before starting, run `git status` to confirm a clean tree on `release/v1.6` (or whatever branch you're on). All work in this plan adds new files under `scripts/marketing-capture/`, `Assets/marketing/`, `website/press-kit/assets/`, and one small additive file in `src/dev/`. The only existing-file modification is a small conditional import block in `src/main.tsx`.

---

### Task 1: Install system dependencies

**Files:** none (verification only).

- [ ] **Step 1: Install Apple SF Pro and SF Mono**

Apple ships the fonts as DMG/PKG. Inside the DMG is a PKG; inside the PKG is a `Payload` cpio.gz. The cleanest path on Linux is `7z` extraction (no shell-piping). Run these commands one at a time:

```
sudo apt-get install -y p7zip-full xar cpio
mkdir -p /tmp/sf-fonts && cd /tmp/sf-fonts
curl -fsSL -o sf-pro.dmg https://devimages-cdn.apple.com/design/resources/download/SF-Pro.dmg
curl -fsSL -o sf-mono.dmg https://devimages-cdn.apple.com/design/resources/download/SF-Mono.dmg
7z x sf-pro.dmg -opro
7z x sf-mono.dmg -omono
find pro mono -name '*.pkg' -exec xar -xf {} \;
find . -name 'Payload' -exec sh -c 'gunzip -c "$1" | cpio -id' _ {} \;
sudo mkdir -p /usr/share/fonts/opentype/sf-pro /usr/share/fonts/opentype/sf-mono
sudo find . -name 'SF-Pro*.otf' -exec cp {} /usr/share/fonts/opentype/sf-pro/ \;
sudo find . -name 'SF-Mono*.otf' -exec cp {} /usr/share/fonts/opentype/sf-mono/ \;
sudo fc-cache -fv
```

- [ ] **Step 2: Verify SF Pro is registered**

Run: `fc-list :family | grep -ic "SF Pro"`
Expected: a number ≥ 6.

- [ ] **Step 3: Install ffmpeg**

Run: `sudo apt-get install -y ffmpeg && ffmpeg -version | head -1`
Expected: a `ffmpeg version 6.x.x` line.

- [ ] **Step 4: Verify Playwright Chromium**

Run: `cd ~/projelli && npx playwright install chromium --with-deps && npx playwright --version`
Expected: a version number.

- [ ] **Step 5: No commit (system-only changes).**

---

### Task 2: Scaffold the marketing-capture project

**Files:**
- Create: `scripts/marketing-capture/package.json`
- Create: `scripts/marketing-capture/tsconfig.json`
- Create: `scripts/marketing-capture/.gitignore`
- Create: `scripts/marketing-capture/README.md`
- Modify: `package.json` (top-level — add `capture:all` script)

- [ ] **Step 1: Write `scripts/marketing-capture/package.json`:**

```
{
  "name": "projelli-marketing-capture",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {
    "run-all": "tsx run-all.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "playwright": "^1.58.0",
    "sharp": "^0.33.5"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write `scripts/marketing-capture/tsconfig.json`:**

```
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 3: Write `scripts/marketing-capture/.gitignore`:**

```
node_modules/
.tmp/
out/raw/
```

- [ ] **Step 4: Write `scripts/marketing-capture/README.md`:**

```
# Projelli Marketing Capture

Produces the marketing asset library (11 stills + 1 video) reproducibly
from headless Chromium.

Quickstart:

    cd scripts/marketing-capture
    npm install
    npm run run-all

Output: ~/projelli/Assets/marketing/ and website/press-kit/assets/.
See ../docs/marketing/asset-capture/SPEC.md for design details.
```

- [ ] **Step 5: Add a top-level npm script.** In `~/projelli/package.json`, under `"scripts"`, add:

```
"capture:all": "cd scripts/marketing-capture && npm install --silent && npm run run-all"
```

- [ ] **Step 6: Install deps.** Run: `cd ~/projelli/scripts/marketing-capture && npm install`. Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit.** Run: `cd ~/projelli && git add scripts/marketing-capture/ package.json && git commit -m "scripts: scaffold marketing-capture project"`.

---

### Task 3: Add the marketing-capture bridge to the Projelli app

**Files:**
- Create: `src/dev/marketing-capture-bridge.ts`
- Modify: `src/main.tsx`

The bridge exposes `window.__projelli_seed(state)` and `window.__projelli_signal(name)`. Mounted ONLY when `import.meta.env.VITE_MARKETING_CAPTURE === '1'`. Production builds do not include it.

- [ ] **Step 1: Create the bridge file:**

```ts
// src/dev/marketing-capture-bridge.ts
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkflowStore } from '@/stores/workflowStore';

export interface SeedPayload {
  workspace?: Partial<ReturnType<typeof useWorkspaceStore.getState>>;
  editor?: Partial<ReturnType<typeof useEditorStore.getState>>;
  aiChat?: Partial<ReturnType<typeof useAIChatStore.getState>>;
  settings?: Partial<ReturnType<typeof useSettingsStore.getState>>;
  workflow?: Partial<ReturnType<typeof useWorkflowStore.getState>>;
  skipOnboarding?: boolean;
}

declare global {
  interface Window {
    __projelli_seed?: (payload: SeedPayload) => void;
    __projelli_signal?: (name: string, data?: unknown) => void;
    __projelli_signals?: Array<{ name: string; data?: unknown; ts: number }>;
  }
}

export function mountMarketingCaptureBridge(): void {
  window.__projelli_seed = (payload) => {
    if (payload.workspace) useWorkspaceStore.setState(payload.workspace);
    if (payload.editor) useEditorStore.setState(payload.editor);
    if (payload.aiChat) useAIChatStore.setState(payload.aiChat);
    if (payload.settings) useSettingsStore.setState(payload.settings);
    if (payload.workflow) useWorkflowStore.setState(payload.workflow);
    if (payload.skipOnboarding) {
      localStorage.setItem('projelli.onboarding.complete', 'true');
    }
  };

  window.__projelli_signals = [];
  window.__projelli_signal = (name, data) => {
    window.__projelli_signals!.push({ name, data, ts: Date.now() });
  };

  console.info('[projelli] marketing-capture bridge mounted');
}
```

- [ ] **Step 2: Wire into `src/main.tsx`.** Read the existing file first; preserve its structure. The change is to add (before `ReactDOM.createRoot(...).render(...)`):

```ts
if (import.meta.env.VITE_MARKETING_CAPTURE === '1') {
  const { mountMarketingCaptureBridge } = await import('./dev/marketing-capture-bridge');
  mountMarketingCaptureBridge();
}
```

If `main.tsx` is not currently top-level-async, wrap it in a `bootstrap()` async function. Match the existing pattern.

- [ ] **Step 3: Verify the bridge mounts in dev.** Start the dev server: `cd ~/projelli && VITE_MARKETING_CAPTURE=1 npm run dev`. In a separate terminal, run a one-off Playwright check:

```ts
// /tmp/verify-bridge.ts
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173');
await page.waitForLoadState('networkidle');
const exists = await page.evaluate(() => typeof (window as any).__projelli_seed === 'function');
console.log('bridge present:', exists);
await browser.close();
```

Run: `cd ~/projelli/scripts/marketing-capture && npx tsx /tmp/verify-bridge.ts`. Expected: `bridge present: true`.

- [ ] **Step 4: Verify the bridge does NOT ship in prod.** Run: `cd ~/projelli && npm run build && grep -r "__projelli_seed" dist/ ; echo "exit: $?"`. Expected: no matches (exit 1 from grep).

- [ ] **Step 5: Commit.** `git add src/dev/marketing-capture-bridge.ts src/main.tsx && git commit -m "feat(dev): marketing-capture bridge for screenshot pipeline"`.

---

### Task 4: Build the macOS chrome compositor

**Files:**
- Create: `scripts/marketing-capture/lib/compose-chrome.ts`
- Create: `scripts/marketing-capture/lib/compose-chrome.test.ts`
- Create: `scripts/marketing-capture/chrome-template/sequoia-window.html`

- [ ] **Step 1: Write `chrome-template/sequoia-window.html`:**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 100%; height: 100%;
    background: linear-gradient(135deg, #F5F5F7 0%, #EAEAEC 100%);
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
  }
  .window { box-shadow: 0 24px 48px rgba(0,0,0,0.18), 0 8px 16px rgba(0,0,0,0.10);
            border-radius: 12px; overflow: hidden; background: white; }
  .titlebar { height: 28px; background: linear-gradient(180deg,#ECECEC 0%,#DCDCDC 100%);
              border-bottom: 1px solid rgba(0,0,0,0.12); display: flex;
              align-items: center; padding: 0 12px; }
  .traffic-lights { display: flex; gap: 8px; }
  .traffic-lights .dot { width: 12px; height: 12px; border-radius: 50%;
                         border: 0.5px solid rgba(0,0,0,0.18); }
  .traffic-lights .close { background: #FF5F57; }
  .traffic-lights .min   { background: #FEBC2E; }
  .traffic-lights .max   { background: #28C840; }
  .title { flex: 1; text-align: center; font-size: 13px; font-weight: 500;
           color: #4A4A4A; margin-right: 60px; }
  .content img { display: block; width: 100%; height: auto; }
</style></head><body>
  <div class="window" id="window">
    <div class="titlebar">
      <div class="traffic-lights">
        <span class="dot close"></span><span class="dot min"></span><span class="dot max"></span>
      </div>
      <div class="title" id="title">Projelli</div>
    </div>
    <div class="content"><img id="screenshot" alt=""></div>
  </div>
</body></html>
```

- [ ] **Step 2: Write the failing test.** Create `lib/compose-chrome.test.ts`:

```ts
import { test, expect } from 'vitest';
import { composeChrome } from './compose-chrome';
import sharp from 'sharp';

test('composeChrome wraps PNG in macOS frame at expected dimensions', async () => {
  const fakeScreenshot = await sharp({
    create: { width: 1280, height: 800, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).png().toBuffer();

  const out = await composeChrome(fakeScreenshot, { title: 'Projelli — Test' });
  const meta = await sharp(out).metadata();
  expect(meta.format).toBe('png');
  expect(meta.width).toBeGreaterThan(1280);
  expect(meta.height).toBeGreaterThan(800 + 28);
});
```

- [ ] **Step 3: Run, expect FAIL.** `npx vitest run lib/compose-chrome.test.ts`. Expected: FAIL with "Cannot find module './compose-chrome'".

- [ ] **Step 4: Implement `lib/compose-chrome.ts`:**

```ts
import { chromium, type Browser } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../chrome-template/sequoia-window.html'
);

let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (!cachedTemplate) cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf-8');
  return cachedTemplate;
}

export interface ComposeChromeOptions {
  title?: string;
  padding?: number;
  browser?: Browser;
}

export async function composeChrome(
  screenshot: Buffer,
  opts: ComposeChromeOptions = {}
): Promise<Buffer> {
  const { title = 'Projelli', padding = 80 } = opts;
  const ownsBrowser = !opts.browser;
  const browser = opts.browser ?? await chromium.launch();

  try {
    const html = loadTemplate().replace(
      '<div class="title" id="title">Projelli</div>',
      `<div class="title" id="title">${escapeHtml(title)}</div>`
    );

    const dataUrl = `data:image/png;base64,${screenshot.toString('base64')}`;

    const page = await browser.newPage({
      viewport: { width: 100, height: 100 },
      deviceScaleFactor: 2,
    });
    await page.setContent(html);
    await page.evaluate((url) => {
      (document.getElementById('screenshot') as HTMLImageElement).src = url;
    }, dataUrl);
    await page.waitForFunction(() => {
      const img = document.getElementById('screenshot') as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    });

    const dims = await page.evaluate((pad) => {
      const win = document.getElementById('window')!;
      const r = win.getBoundingClientRect();
      return { w: Math.ceil(r.width + pad * 2), h: Math.ceil(r.height + pad * 2) };
    }, padding);
    await page.setViewportSize({ width: dims.w, height: dims.h });

    const buf = await page.screenshot({ type: 'png', fullPage: false });
    await page.close();
    return buf;
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}
```

- [ ] **Step 5: Run, expect PASS.** `npx vitest run lib/compose-chrome.test.ts`. Expected: PASS, 1 test.

- [ ] **Step 6: Smoke check (manual).** Write a temporary `lib/compose-chrome.smoke.ts` that builds a solid-color dummy and runs `composeChrome`. Save the output to `.tmp/smoke-chrome.png`. `scp` to local; verify red rectangle inside macOS chrome with rounded corners + drop shadow + title centered. Delete the smoke file after.

- [ ] **Step 7: Commit.** `git add scripts/marketing-capture/lib/compose-chrome.ts scripts/marketing-capture/lib/compose-chrome.test.ts scripts/marketing-capture/chrome-template/ && git commit -m "feat(capture): macOS chrome compositor"`.

---

### Task 5: Build the macOS CSS injection layer

**Files:**
- Create: `scripts/marketing-capture/lib/inject-mac-styles.ts`
- Create: `scripts/marketing-capture/lib/inject-mac-styles.test.ts`

- [ ] **Step 1: Write the failing test.** `lib/inject-mac-styles.test.ts`:

```ts
import { test, expect } from 'vitest';
import { macStyles } from './inject-mac-styles';

test('macStyles returns CSS with key selectors', () => {
  const css = macStyles();
  expect(css).toContain('-apple-system');
  expect(css).toContain('"SF Pro Text"');
  expect(css).toContain('::-webkit-scrollbar');
  expect(css).toContain('#007AFF');
  expect(css.length).toBeGreaterThan(200);
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run lib/inject-mac-styles.test.ts`.

- [ ] **Step 3: Implement `lib/inject-mac-styles.ts`:**

```ts
export function macStyles(): string {
  return `
    html, body, * {
      font-family: -apple-system, "SF Pro Text", "SF Pro Display",
                   "Inter", system-ui, sans-serif !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    code, pre, kbd, samp, .font-mono, [class*="mono"] {
      font-family: "SF Mono", ui-monospace, "Menlo", "Roboto Mono", monospace !important;
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.25);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.40); }
    ::-webkit-scrollbar-corner { background: transparent; }
    ::selection { background: rgba(0,122,255,0.25); }
    :focus-visible { outline-color: #007AFF !important; }
    input:focus, textarea:focus, button:focus { outline-offset: 2px; }
  `;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit.** `git add ... && git commit -m "feat(capture): macOS CSS injection layer"`.

---

### Task 6: Build the Linterly fixture

**Files:**
- Create: `scripts/marketing-capture/fixtures/linterly-workspace.ts`

- [ ] **Step 1: Write the fixture.** Pure data — every markdown file's contents, the chat history, settings, and per-shot UI overrides. Full content in SPEC.md § State seeding. Key shape:

```ts
import type { FileNode } from '../../../src/types/workspace';

const ROOT = '/Users/jameson/Projelli/Linterly';

const fileContents: Record<string, string> = {
  'Vision.md': `# Linterly — Vision\n\n... (see SPEC § State seeding)`,
  'Pricing.md': `# Linterly Pricing\n\n... (see SPEC § State seeding)`,
  'Customers.md': `... (8 files total — full text per spec)`,
  // ... 5 more
};

const fileTree: FileNode[] = Object.keys(fileContents).map((name, idx) => ({
  id: `f${idx}`,
  name,
  path: `${ROOT}/${name}`,
  type: 'file',
  extension: 'md',
  size: fileContents[name].length,
  modifiedAt: new Date(2026, 3, 22 + (idx % 5)),
}));

export const linterlyFixture = {
  rootPath: ROOT,
  files: fileTree,
  fileContents,
  shots: {
    workspaceHero: { activeFile: 'Launch Plan.md', backlinksOpen: false, chatPanelOpen: true, chatStreaming: false },
    aiMidStream:   { activeFile: 'Launch Plan.md', chatPanelOpen: true, chatStreaming: true, streamingTarget: 'Brand Voice.md' },
    wikiLinks:     { activeFile: 'Vision.md', backlinksOpen: true },
    templates:     { activeView: 'workflow', activeWorkflow: 'customer-discovery', workflowStep: 4, workflowTotal: 10 },
    multiModel:    { activeView: 'multi-model', prompt: 'Draft a one-paragraph vision statement for Linterly.' },
    apiKeys:       { activeView: 'settings-api-keys' },
    documentSuite: { activeFile: 'Pricing.md', openTabs: ['Pricing.md', 'Q1 Forecast.xlsx', 'Pitch Deck.pptx'] },
  },
  settings: {
    providers: [
      { id: 'anthropic', label: 'Anthropic', keyMasked: 'sk-ant-api03-•••••••••3xQ', defaultModel: 'claude-opus-4-7' },
      { id: 'openai', label: 'OpenAI', keyMasked: 'sk-•••••••••8aB', defaultModel: 'gpt-4o' },
      { id: 'gemini', label: 'Google Gemini', keyMasked: null, defaultModel: null },
    ],
    defaultProvider: 'anthropic',
    defaultModel: 'claude-opus-4-7',
  },
  chats: [
    { id: 'chat-1', title: 'Help me write a vision statement', messages: [], createdAt: new Date(2026, 3, 22).toISOString() },
    { id: 'chat-2', title: 'Customer interview script for indie hackers', messages: [], createdAt: new Date(2026, 3, 23).toISOString() },
    { id: 'chat-3', title: 'Pricing tiers for AI grammar tool', messages: [], createdAt: new Date(2026, 3, 24).toISOString() },
  ],
};

export type LinterlyFixture = typeof linterlyFixture;
```

Fill in the full file contents from SPEC.md § State seeding (8 files, real text with `[[wiki-links]]` between them).

- [ ] **Step 2: Type-check.** `cd scripts/marketing-capture && npx tsc --noEmit`. Expected: 0 errors. Adjust path to `FileNode` import if `@/types/workspace` alias isn't reachable from this folder (use a relative path).

- [ ] **Step 3: Commit.** `git add ... && git commit -m "feat(capture): linterly workspace fixture"`.

---

### Task 7: Build the state seeder

**Files:**
- Create: `scripts/marketing-capture/lib/seed-state.ts`

- [ ] **Step 1: Implement:**

```ts
import type { Page } from 'playwright';
import type { LinterlyFixture } from '../fixtures/linterly-workspace';

export type ShotKey = keyof LinterlyFixture['shots'];

export async function seedState(
  page: Page,
  fixture: LinterlyFixture,
  shot: ShotKey
): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as any).__projelli_seed === 'function',
    null,
    { timeout: 10_000 }
  );

  const shotConfig = fixture.shots[shot] as Record<string, unknown>;

  await page.evaluate(({ fixture, shotConfig }) => {
    const seed = (window as any).__projelli_seed!;
    const activeFile = (shotConfig as any).activeFile as string | undefined;
    seed({
      skipOnboarding: true,
      workspace: {
        rootPath: fixture.rootPath,
        fileTree: fixture.files,
        selectedPath: activeFile ? `${fixture.rootPath}/${activeFile}` : null,
        expandedPaths: new Set([fixture.rootPath]),
      },
      editor: activeFile ? {
        tabs: [{
          path: `${fixture.rootPath}/${activeFile}`,
          name: activeFile,
          content: fixture.fileContents[activeFile],
          isDirty: false,
        }],
        activeTabPath: `${fixture.rootPath}/${activeFile}`,
      } : {},
      aiChat: { sessions: fixture.chats },
      settings: fixture.settings,
    });
  }, { fixture, shotConfig });

  await page.waitForTimeout(100);
}
```

- [ ] **Step 2: Smoke test.** Write a temporary `lib/seed-state.smoke.ts` that boots Chromium, navigates to `localhost:5173`, calls `seedState(page, linterlyFixture, 'workspaceHero')`, screenshots to `.tmp/smoke-seed.png`. Run with the dev server up. Eyeball: file tree shows the 8 Linterly files, editor opens `Launch Plan.md`. If empty: inspect the actual store shapes in `src/stores/` and adjust the seeder shape to match. Common adjustments: `tabs` field name in editorStore, `expandedPaths` Set vs Array.

- [ ] **Step 3: Delete the smoke script. Commit.** `git add scripts/marketing-capture/lib/seed-state.ts && git commit -m "feat(capture): zustand state seeder"`.

---

### Task 8: Build the AI replay layer + record fixture chunks

**Files:**
- Create: `scripts/marketing-capture/lib/mock-ai.ts`
- Create: `scripts/marketing-capture/fixtures/ai-replays/launch-plan-stream.json`
- Create: `scripts/marketing-capture/fixtures/ai-replays/multi-model-claude.json`
- Create: `scripts/marketing-capture/fixtures/ai-replays/multi-model-gpt.json`

- [ ] **Step 1: Write `launch-plan-stream.json`:**

```json
{
  "model": "claude-opus-4-7",
  "chunks": [
    { "delayMs": 0,   "text": "Here's a brand-voice draft for Linterly:" },
    { "delayMs": 200, "text": "\n\n**Voice principles**\n\n" },
    { "delayMs": 80,  "text": "Linterly writes the way a senior PM" },
    { "delayMs": 70,  "text": " Slacks: short, specific, contraction-heavy," },
    { "delayMs": 90,  "text": " never breathless.\n\n" },
    { "delayMs": 120, "text": "**Banned words:** leverage, delve, seamless," },
    { "delayMs": 60,  "text": " transform, empower, elevate, unlock.\n\n" },
    { "delayMs": 100, "text": "**Banned patterns:** \"It's not X, it's Y.\"" },
    { "delayMs": 80,  "text": " Italicized fragments at the end of sentences." },
    { "delayMs": 70,  "text": " Em dashes in marketing copy.\n\n" },
    { "delayMs": 150, "text": "I'll save this to Brand Voice.md in your" },
    { "delayMs": 60,  "text": " workspace." }
  ],
  "createdFile": "Brand Voice.md"
}
```

Write the multi-model fixtures similarly, with shorter contrasting paragraphs (Claude voice vs GPT voice on the same vision-statement prompt).

- [ ] **Step 2: Decide the streaming approach.** Two options:

**Option A — Playwright route with paced stream body.** `route.fulfill` accepts a streaming body in Playwright ≥1.40 by passing a Node stream. Implement a `Readable` that emits SSE chunks at recorded delays.

**Option B — Local SSE proxy server.** Stand up a small HTTP server in-process on `localhost:5174` that serves `/anthropic`, `/openai`, etc. with paced SSE responses; rewrite provider base URLs in the fixture's `settings.providers` to point at it.

**Recommendation: Option A** if Playwright supports streaming fulfill in the installed version (`npx playwright --version`). Otherwise Option B. Try Option A first; if `route.fulfill({ body: readableStream })` errors, fall back to B.

- [ ] **Step 3: Implement (Option A version) `lib/mock-ai.ts`:**

```ts
import type { Page, Route } from 'playwright';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/ai-replays'
);

interface ReplayChunk { delayMs: number; text: string; }
interface Replay { model: string; chunks: ReplayChunk[]; createdFile?: string; }

export async function mockAI(page: Page, replayName: string): Promise<void> {
  const fixturePath = path.join(FIXTURES_DIR, `${replayName}.json`);
  const replay: Replay = JSON.parse(readFileSync(fixturePath, 'utf-8'));

  const handler = async (route: Route) => {
    const stream = buildPacedSseStream(replay);
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      },
      body: stream as unknown as Buffer, // playwright accepts streams via type assertion
    });
  };

  await page.route('**/api.anthropic.com/**', handler);
  await page.route('**/api.openai.com/**', handler);
  await page.route('**/generativelanguage.googleapis.com/**', handler);
}

function buildPacedSseStream(replay: Replay): Readable {
  let i = 0;
  const stream = new Readable({ read() {} });
  const tick = () => {
    if (i >= replay.chunks.length) {
      stream.push(`data: {"type":"message_stop"}\n\n`);
      stream.push(null);
      return;
    }
    const chunk = replay.chunks[i++];
    setTimeout(() => {
      const event = { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk.text } };
      stream.push(`data: ${JSON.stringify(event)}\n\n`);
      tick();
    }, chunk.delayMs);
  };
  tick();
  return stream;
}
```

If Playwright rejects streams: replace with Option B (a local Express/http SSE server). The same `Replay` JSON works either way.

- [ ] **Step 4: Smoke test.** Write a script that boots Chromium, mounts `mockAI`, navigates to a chat URL, types a prompt, and prints the chat text every 500ms. Verify text grows in chunks, not all-at-once. Delete the smoke file after.

- [ ] **Step 5: Commit.** `git add scripts/marketing-capture/lib/mock-ai.ts scripts/marketing-capture/fixtures/ai-replays/ && git commit -m "feat(capture): canned AI replay layer"`.

---

### Task 9: Build the still-shot orchestration helper

**Files:**
- Create: `scripts/marketing-capture/lib/capture-still.ts`

- [ ] **Step 1: Implement:**

```ts
import { chromium, type Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState, type ShotKey } from './seed-state';
import { macStyles } from './inject-mac-styles';
import { mockAI } from './mock-ai';
import { composeChrome } from './compose-chrome';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');

export interface StillShotOptions {
  shotKey: ShotKey;
  outputName: string;
  pressKit?: boolean;
  viewport: { width: number; height: number };
  aiReplay?: string;
  windowTitle?: string;
  beforeShot?: (page: Page) => Promise<void>;
  raw?: boolean;
}

export async function captureStill(opts: StillShotOptions): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: opts.viewport,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    if (opts.aiReplay) await mockAI(page, opts.aiReplay);

    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    await page.addStyleTag({ content: macStyles() });
    await seedState(page, linterlyFixture, opts.shotKey);

    if (opts.beforeShot) await opts.beforeShot(page);
    await page.waitForTimeout(300);

    const raw = await page.screenshot({ type: 'png', fullPage: false });
    const final = opts.raw
      ? raw
      : await composeChrome(raw, { title: opts.windowTitle ?? 'Projelli', browser });

    mkdirSync(ASSETS_DIR, { recursive: true });
    const outPath = path.join(ASSETS_DIR, opts.outputName);
    writeFileSync(outPath, final);

    if (opts.pressKit) {
      mkdirSync(PRESS_KIT_DIR, { recursive: true });
      writeFileSync(path.join(PRESS_KIT_DIR, opts.outputName), final);
    }

    return outPath;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Commit.** `git add scripts/marketing-capture/lib/capture-still.ts && git commit -m "feat(capture): still-shot orchestration helper"`.

---

### Task 10: Capture S01 — Workspace hero

**Files:** Create `scripts/marketing-capture/shots/01-workspace-hero.ts`.

- [ ] **Step 1: Write:**

```ts
import { captureStill } from '../lib/capture-still';

export async function shot01() {
  return captureStill({
    shotKey: 'workspaceHero',
    outputName: 'screenshot-01-workspace.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot01().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 2: Run.** With dev server up on port 5173 (with `VITE_MARKETING_CAPTURE=1`), run: `cd scripts/marketing-capture && npx tsx shots/01-workspace-hero.ts`. Expected: a path printed; output PNG exists at `~/projelli/Assets/marketing/screenshot-01-workspace.png` and `~/projelli/website/press-kit/assets/screenshot-01-workspace.png`.

- [ ] **Step 3: Eyeball.** `scp` to local. Confirm: three panes (file tree → editor → chat), 8 files visible in tree, `Launch Plan.md` editor content visible, macOS chrome around the whole thing, SF Pro fonts, no Linux scrollbars.

- [ ] **Step 4: Commit script + outputs.** `git add scripts/marketing-capture/shots/01-workspace-hero.ts Assets/marketing/screenshot-01-workspace.png website/press-kit/assets/screenshot-01-workspace.png && git commit -m "feat(capture): S01 workspace hero"`.

---

### Task 11: Capture S02 — AI mid-stream

**Files:** Create `scripts/marketing-capture/shots/02-ai-chat.ts`.

- [ ] **Step 1: Write:**

```ts
import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

export async function shot02() {
  return captureStill({
    shotKey: 'aiMidStream',
    outputName: 'screenshot-02-ai-chat.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    aiReplay: 'launch-plan-stream',
    windowTitle: 'Linterly — Projelli',
    beforeShot: async (page: Page) => {
      await page.getByTestId('chat-input').fill(
        'Draft a brand voice doc based on Vision.md and Customers.md.'
      );
      await page.getByTestId('chat-send').click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="chat-streaming-message"]');
        return !!(el && el.textContent && el.textContent.length > 200 && el.textContent.length < 500);
      }, null, { timeout: 5000 });
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot02().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 2: Verify required testids exist.** Run: `cd ~/projelli && grep -rE 'data-testid="(chat-input|chat-send|chat-streaming-message)"' src/`. If any missing: add them to the chat components in `src/components/chat/`. Commit those edits separately: `git commit -am "test(chat): add data-testids for marketing capture"`.

- [ ] **Step 3: Run, eyeball, commit.** Same as Task 10 Step 2-4 but with `02-ai-chat`.

---

### Task 12: Capture S03 — Wiki-links + backlinks

**Files:** Create `scripts/marketing-capture/shots/03-wikilinks.ts`.

- [ ] **Step 1: Write:**

```ts
import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

export async function shot03() {
  return captureStill({
    shotKey: 'wikiLinks',
    outputName: 'screenshot-03-wikilinks.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
    beforeShot: async (page: Page) => {
      await page.getByTestId('toggle-backlinks').click();
      await page.waitForFunction(() => {
        const items = document.querySelectorAll('[data-testid="backlink-item"]');
        return items.length >= 2;
      });
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot03().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 2: Verify testids `toggle-backlinks` and `backlink-item`.** Add if missing.
- [ ] **Step 3: Run, eyeball, commit.**

---

### Task 13: Capture S04 — Templates gallery

**Files:** Create `scripts/marketing-capture/shots/04-templates.ts`.

- [ ] **Step 1: Write:**

```ts
import { captureStill } from '../lib/capture-still';

export async function shot04() {
  return captureStill({
    shotKey: 'templates',
    outputName: 'screenshot-04-templates.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot04().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 2: Confirm `workflowStore` accepts `{ activeWorkflow: 'customer-discovery', workflowStep: 4, workflowTotal: 10 }`.** Inspect `src/stores/workflowStore.ts`. Adjust the fixture's shot config if field names differ.

- [ ] **Step 3: Run, eyeball, commit.**

---

### Task 14: Capture S05 — Multi-model side-by-side

**Files:** Create `scripts/marketing-capture/shots/05-multi-model.ts`.

- [ ] **Step 1: Verify multi-model UI exists.** Run: `cd ~/projelli && grep -rE "multi.?model|MultiModel" src/components/ src/stores/`. If empty: defer this shot to v2, document in `SPEC.md` § Out of scope, skip Steps 2–4.

- [ ] **Step 2: Write the shot script:**

```ts
import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';
import claudeReply from '../fixtures/ai-replays/multi-model-claude.json' assert { type: 'json' };
import gptReply from '../fixtures/ai-replays/multi-model-gpt.json' assert { type: 'json' };

const fullText = (chunks: { text: string }[]) => chunks.map((c) => c.text).join('');

export async function shot05() {
  return captureStill({
    shotKey: 'multiModel',
    outputName: 'screenshot-05-multi-model.png',
    pressKit: true,
    viewport: { width: 1440, height: 900 },
    windowTitle: 'Linterly — Projelli',
    beforeShot: async (page: Page) => {
      await page.evaluate(({ left, right }) => {
        (window as any).__projelli_seed!({
          aiChat: {
            multiModel: {
              prompt: 'Draft a one-paragraph vision statement for Linterly.',
              left:  { model: 'claude-opus-4-7', response: left },
              right: { model: 'gpt-4o',          response: right },
            },
          },
        });
      }, { left: fullText(claudeReply.chunks), right: fullText(gptReply.chunks) });
      await page.waitForFunction(() =>
        document.querySelectorAll('[data-testid="multi-model-pane"]').length >= 2
      );
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot05().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 3: Verify testid `multi-model-pane` exists.** Add if missing.
- [ ] **Step 4: Run, eyeball, commit.**

---

### Task 15: Capture S06 — Settings → API keys

**Files:** Create `scripts/marketing-capture/shots/06-api-keys.ts`.

- [ ] **Step 1: Write:**

```ts
import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

export async function shot06() {
  return captureStill({
    shotKey: 'apiKeys',
    outputName: 'screenshot-06-api-keys.png',
    pressKit: true,
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Settings — Projelli',
    beforeShot: async (page: Page) => {
      await page.getByTestId('open-settings').click();
      await page.getByTestId('settings-tab-api-keys').click();
      await page.waitForFunction(() =>
        document.body.innerText.includes('•••') &&
        document.body.innerText.includes('Anthropic')
      );
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot06().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 2: Verify testids `open-settings` and `settings-tab-api-keys`.** Add if missing.
- [ ] **Step 3: Run, eyeball, commit.**

---

### Task 16: Reframe pipeline (S07 + S08 + S09)

**Files:** Create `scripts/marketing-capture/shots/07-09-social-reframes.ts`.

- [ ] **Step 1: Implement:**

```ts
import sharp from 'sharp';
import path from 'node:path';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');

interface Reframe { out: string; width: number; height: number; tagline?: string; }

const REFRAMES: Reframe[] = [
  { out: 'og-twitter-card.png',  width: 1200, height: 675,  tagline: 'Obsidian for the AI era.' },
  { out: 'og-linkedin-card.png', width: 1200, height: 627,  tagline: 'Obsidian for the AI era.' },
  { out: 'social-square.png',    width: 1080, height: 1080 },
];

export async function reframeAll() {
  const heroPath = path.join(ASSETS_DIR, 'screenshot-01-workspace.png');
  const hero = readFileSync(heroPath);
  mkdirSync(ASSETS_DIR, { recursive: true });

  for (const r of REFRAMES) {
    const base = await sharp(hero)
      .resize({ width: r.width, height: r.height, fit: 'cover', position: 'center' })
      .png()
      .toBuffer();

    let out = base;
    if (r.tagline) {
      const overlay = taglineOverlay(r.tagline, r.width, r.height);
      out = await sharp(base).composite([{ input: overlay, gravity: 'south' }]).png().toBuffer();
    }
    const outPath = path.join(ASSETS_DIR, r.out);
    writeFileSync(outPath, out);
    console.log(`✓ ${outPath}`);
  }
}

function taglineOverlay(text: string, w: number, h: number): Buffer {
  const stripH = 80;
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${h - stripH}" width="${w}" height="${stripH}" fill="rgba(0,0,0,0.55)"/>
      <text x="${w / 2}" y="${h - stripH / 2 + 10}" text-anchor="middle"
            font-family="-apple-system, SF Pro Text, sans-serif"
            font-size="32" font-weight="600" fill="white">${escapeXml(text)}</text>
    </svg>`;
  return Buffer.from(svg);
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) =>
    ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]!));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  reframeAll();
}
```

- [ ] **Step 2: Run** (after S01 has been captured). `cd scripts/marketing-capture && npx tsx shots/07-09-social-reframes.ts`. Expected: 3 PNGs in `Assets/marketing/`.
- [ ] **Step 3: Eyeball, commit.**

---

### Task 17: Capture S10 — Document suite

**Files:** Create `scripts/marketing-capture/shots/10-document-suite.ts`.

This shot needs binary fixtures (xlsx, pptx) so the editor has something to render. Two options:

**Option A — Skip Office binary rendering. Show only the .md tab as active, with `.xlsx` and `.pptx` tabs visible but inactive.** Cheap, works today.

**Option B — Generate minimal valid .xlsx/.pptx files with sample content.** Use `exceljs` and `pptxgenjs` (both small npm deps). Requires Projelli's editor to actually render those formats — verify before investing.

- [ ] **Step 1: Decide A vs B.** Default: **A** (cheaper, ships sooner).

- [ ] **Step 2 (Option A): Write the shot script:**

```ts
import { captureStill } from '../lib/capture-still';
import type { Page } from 'playwright';

export async function shot10() {
  return captureStill({
    shotKey: 'documentSuite',
    outputName: 'feature-document-suite.png',
    viewport: { width: 1280, height: 800 },
    windowTitle: 'Linterly — Projelli',
    beforeShot: async (page: Page) => {
      // The fixture seeds 3 tabs; ensure they're visible in the strip.
      await page.waitForFunction(() => {
        const tabs = document.querySelectorAll('[data-testid="editor-tab"]');
        return tabs.length >= 3;
      });
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot10().then((p) => console.log(`✓ ${p}`));
}
```

- [ ] **Step 3: Run, eyeball, commit.**

---

### Task 18: Capture S11 — Local-first with Finder overlay

**Files:**
- Create: `scripts/marketing-capture/shots/11-local-first.ts`
- Create: `scripts/marketing-capture/chrome-template/finder-overlay.html`

The Finder overlay is a small HTML mockup of macOS Finder column-view showing the same 8 files on disk. Composited into the bottom-right corner of the workspace screenshot.

- [ ] **Step 1: Write `finder-overlay.html`.** ~80 lines: title bar, sidebar with home icon + "Linterly" folder, column showing file rows with macOS-typical text-icon. Match SF Pro fonts, 12px corner radius, drop shadow.

- [ ] **Step 2: Write the shot script:**

```ts
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { captureStill } from '../lib/capture-still';
import { composeChrome } from '../lib/compose-chrome';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const FINDER_HTML = path.resolve(HERE, '../chrome-template/finder-overlay.html');

async function renderFinder(): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 320 }, deviceScaleFactor: 2 });
    await page.setContent(readFileSync(FINDER_HTML, 'utf-8'));
    return await page.screenshot({ type: 'png', omitBackground: true });
  } finally {
    await browser.close();
  }
}

export async function shot11() {
  // 1) Capture raw workspace hero (no chrome).
  await captureStill({
    shotKey: 'workspaceHero',
    outputName: '.tmp-workspace-raw.png',
    viewport: { width: 1280, height: 800 },
    raw: true,
  });

  // 2) Render Finder overlay.
  const finder = await renderFinder();

  // 3) Composite finder into bottom-right of raw shot.
  const rawPath = path.join(ASSETS_DIR, '.tmp-workspace-raw.png');
  const composited = await sharp(readFileSync(rawPath))
    .composite([{ input: finder, gravity: 'southeast', top: -32, left: -32 }])
    .png().toBuffer();

  // 4) Wrap in macOS chrome.
  const final = await composeChrome(composited, { title: 'Linterly — Projelli' });

  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'feature-local-first.png');
  writeFileSync(outPath, final);

  // Cleanup the temp raw.
  try { (await import('node:fs')).unlinkSync(rawPath); } catch {}

  console.log(`✓ ${outPath}`);
  return outPath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  shot11();
}
```

- [ ] **Step 3: Run, eyeball, commit.**

---

### Task 19: Capture V01 — 30-second demo video

**Files:**
- Create: `scripts/marketing-capture/videos/01-demo-30s.ts`
- Create: `scripts/marketing-capture/chrome-template/sequoia-chrome-1920x1080.png` (precomputed, see Step 2)

- [ ] **Step 1: Implement `videos/01-demo-30s.ts`:**

```ts
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { linterlyFixture } from '../fixtures/linterly-workspace';
import { seedState } from '../lib/seed-state';
import { macStyles } from '../lib/inject-mac-styles';
import { mockAI } from '../lib/mock-ai';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(HERE, '../../../Assets/marketing');
const PRESS_KIT_DIR = path.resolve(HERE, '../../../website/press-kit/assets');
const CHROME_PNG = path.resolve(HERE, '../chrome-template/sequoia-chrome-1920x1080.png');
const VIDEO_TMP = path.resolve(HERE, '../.tmp/video');

export async function video01() {
  mkdirSync(VIDEO_TMP, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_TMP, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  await mockAI(page, 'launch-plan-stream');

  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: macStyles() });
  await seedState(page, linterlyFixture, 'workspaceHero');

  await page.waitForTimeout(2000);                      // t=0–2s idle
  await page.getByTestId('chat-input').click();         // t=2 focus
  await page.keyboard.type(
    'Draft a brand voice doc based on Vision.md and Customers.md.',
    { delay: 80 }
  );                                                    // ~t=2–4s typing
  await page.waitForTimeout(300);
  await page.getByTestId('chat-send').click();
  await page.waitForTimeout(18_000);                    // t=4–22s streaming
  await page
    .getByTestId('file-tree-item')
    .filter({ hasText: 'Brand Voice.md' })
    .click();                                           // t=22–25s click new file
  await page.waitForTimeout(3000);
  await page.waitForTimeout(5000);                      // t=25–30s hold

  await page.close();
  await context.close();
  await browser.close();

  // Find the recorded webm.
  const webm = readdirSync(VIDEO_TMP).find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('No .webm produced by Playwright recordVideo');
  const webmPath = path.join(VIDEO_TMP, webm);

  // Compose chrome via ffmpeg with execFileSync (NO shell).
  mkdirSync(ASSETS_DIR, { recursive: true });
  const outPath = path.join(ASSETS_DIR, 'demo-30s.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-i', webmPath,
    '-i', CHROME_PNG,
    '-filter_complex',
      '[0:v]scale=1808:1004[scaled];[scaled][1:v]overlay=56:48,format=yuv420p[v]',
    '-map', '[v]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-r', '30',
    outPath,
  ], { stdio: 'inherit' });

  mkdirSync(PRESS_KIT_DIR, { recursive: true });
  copyFileSync(outPath, path.join(PRESS_KIT_DIR, 'demo-30s.mp4'));
  console.log(`✓ ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  video01();
}
```

- [ ] **Step 2: Generate the static `sequoia-chrome-1920x1080.png`.** One-time: write a temporary `lib/build-video-chrome.ts` that calls `composeChrome` on a 1808×1004 fully-transparent input image (sharp can produce one), and saves the result as `chrome-template/sequoia-chrome-1920x1080.png`. Adjust the `composeChrome` template's CSS to NOT add the gradient background for video chrome (since the workspace fills the content area). Run once, commit the PNG, delete the script.

- [ ] **Step 3: Run end-to-end.** With dev server up: `cd scripts/marketing-capture && npx tsx videos/01-demo-30s.ts`. Expected: ~3-5 MB MP4 in `Assets/marketing/demo-30s.mp4`, ~30s duration.

- [ ] **Step 4: Eyeball.** Verify smooth streaming text, file appearance at ~14s, editor switch at ~25s, no Linux artifacts.

- [ ] **Step 5: Commit.** `git add scripts/marketing-capture/videos/ scripts/marketing-capture/chrome-template/sequoia-chrome-1920x1080.png Assets/marketing/demo-30s.mp4 website/press-kit/assets/demo-30s.mp4 && git commit -m "feat(capture): V01 30-second demo video"`.

---

### Task 20: Build the run-all orchestrator

**Files:** Create `scripts/marketing-capture/run-all.ts`.

- [ ] **Step 1: Implement.** Uses `execFileSync` (no shell), `spawn` with array args:

```ts
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shot01 } from './shots/01-workspace-hero';
import { shot02 } from './shots/02-ai-chat';
import { shot03 } from './shots/03-wikilinks';
import { shot04 } from './shots/04-templates';
import { shot05 } from './shots/05-multi-model';
import { shot06 } from './shots/06-api-keys';
import { reframeAll } from './shots/07-09-social-reframes';
import { shot10 } from './shots/10-document-suite';
import { shot11 } from './shots/11-local-first';
import { video01 } from './videos/01-demo-30s';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJELLI_ROOT = path.resolve(HERE, '../../');

function preflight() {
  const fonts = execFileSync('fc-list', [':family'], { encoding: 'utf-8' });
  if (!/SF Pro/i.test(fonts)) {
    throw new Error('SF Pro fonts not installed. See SPEC § Mac-styling layer.');
  }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { throw new Error('ffmpeg not installed (apt install ffmpeg).'); }
  console.log('✓ preflight');
}

async function startDevServer() {
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: PROJELLI_ROOT,
    env: { ...process.env, VITE_MARKETING_CAPTURE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server timeout')), 60_000);
    proc.stdout.on('data', (b: Buffer) => {
      if (b.toString().includes('localhost:5173')) {
        clearTimeout(timer); resolve();
      }
    });
  });
  await sleep(2000);
  return { kill: () => proc.kill('SIGTERM') };
}

async function main() {
  const start = Date.now();
  preflight();
  const dev = await startDevServer();
  try {
    await shot01();
    await shot02();
    await shot03();
    await shot04();
    await shot05();
    await shot06();
    await reframeAll();
    await shot10();
    await shot11();
    await video01();
  } finally {
    dev.kill();
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nLibrary built in ${elapsed}s.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run end-to-end.** `cd ~/projelli && npm run capture:all`. Expected: ~5 minutes, all 11 PNGs + 1 MP4 written, no errors.

- [ ] **Step 3: Commit.** `git add scripts/marketing-capture/run-all.ts && git commit -m "feat(capture): run-all orchestrator"`.

---

### Task 21: Final library run, eyeball, commit assets

- [ ] **Step 1: Clean previous outputs.** `rm -f ~/projelli/Assets/marketing/*.png ~/projelli/Assets/marketing/*.mp4 ~/projelli/website/press-kit/assets/screenshot-*.png ~/projelli/website/press-kit/assets/demo-30s.mp4`.

- [ ] **Step 2: Run the full library.** `cd ~/projelli && npm run capture:all`. Expected: clean run.

- [ ] **Step 3: Eyeball every output.** `scp` the entire `Assets/marketing/` and the press-kit folder to local. Walk each asset against the description in `SPEC.md` § Scope. For mismatches: file an issue (do NOT fix in this task — document the gap, ship the rest).

- [ ] **Step 4: Verify press-kit page.** `cd ~/projelli && bash infra/deploy.sh`. Visit `https://projelli.com/press-kit/` and confirm all 6 screenshot slots show the new images.

- [ ] **Step 5: Commit final assets.** `git add Assets/marketing/ website/press-kit/assets/ && git commit -m "feat: marketing asset library v1 (11 stills + 30s video)"`.

- [ ] **Step 6: Mark action-pack items D + E shipped.** Edit `docs/marketing/action-packs/JAMESON_ACTION_PACK.md` to strike through Items D and E and add a "✓ Done — see scripts/marketing-capture/" note. Update `BACKLOG.md` similarly. Commit: `git commit -am "chore: mark marketing assets D+E shipped"`.

---

## Self-review notes

**Spec coverage:**

| Spec section | Plan task |
|---|---|
| Architecture | Task 2 |
| Mac-styling: fonts | Task 1 |
| Mac-styling: scrollbars/accents | Task 5 |
| Mac-styling: chrome composite | Task 4 |
| State seeding bridge | Task 3 |
| State seeding fixture | Task 6 |
| State seeder | Task 7 |
| Canned AI streaming | Task 8 |
| Tier 1 stills (S01–S06) | Tasks 10–15 |
| Tier 2 stills (S07–S09 reframes) | Task 16 |
| Tier 2 stills (S10 document suite) | Task 17 |
| Tier 2 stills (S11 local-first) | Task 18 |
| Demo video V01 | Task 19 |
| Output destinations | Tasks 9–19 (each shot writes both paths) |
| Acceptance criteria | Tasks 20–21 |

**Known under-specified spots flagged inline (intentional unknowns):**
- Task 8 Step 2: streaming approach (Playwright stream vs SSE proxy) decided at runtime.
- Task 14 Step 1: defer S05 if multi-model UI doesn't exist yet.
- Task 17 Step 1: defer Office binary rendering; ship simpler tab-strip-only version.
- Task 18 Step 1: Finder overlay HTML written at implementation time (~80 lines).

**Subprocess safety:** every `execFile`/`spawn` call uses array args; no shelled-out string interpolation. Matches `src/utils/execFileNoThrow.ts` convention.

**Type consistency check:** `seedState` accepts `LinterlyFixture` from Task 6; `captureStill` accepts `ShotKey` from Task 7; both used consistently throughout shot scripts. Bridge's `SeedPayload` interface (Task 3) matches the shape used by `seedState` (Task 7).

---

**Status:** plan written 2026-04-27. Ready for execution.
