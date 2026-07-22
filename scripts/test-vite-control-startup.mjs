#!/usr/bin/env node
/**
 * Proves the Vite startup controls that keep the desktop app's development
 * server focused on this checkout. This is deliberately local-only: it reads
 * no browser page text, storage, workspace data, credentials, or responses.
 */
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anymatch from 'anymatch';
import { createServer, loadConfigFromFile } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(root, 'vite.config.ts');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lantern-vite-control-'));
let vite;
let browserContext;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDeadline(label, promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolve)
  );
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== 'string', 'could not allocate a loopback port');
  return address.port;
}

async function localStatus(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status;
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(label, condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(`${label} exceeded ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`);
}

function chromiumPath() {
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
    existsSync
  );
}

async function proveBrowser(origin) {
  const executablePath = chromiumPath();
  if (!executablePath) {
    console.log('Vite control startup: Chromium not installed; browser proof skipped');
    return;
  }

  const { chromium } = await import('playwright');
  browserContext = await withDeadline(
    'Chromium launch',
    chromium.launchPersistentContext(path.join(tempRoot, 'chromium-profile'), {
      executablePath,
      headless: true,
    }),
    10_000
  );
  const page = await browserContext.newPage();
  const failures = { console: 0, page: 0, request: 0 };
  const responses = new Map();
  page.on('console', (message) => {
    if (message.type() === 'error') failures.console += 1;
  });
  page.on('pageerror', () => {
    failures.page += 1;
  });
  page.on('requestfailed', () => {
    failures.request += 1;
  });
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin || ['about:', 'blob:', 'data:'].includes(requestUrl.protocol)) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  page.on('response', (response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin === origin) responses.set(responseUrl.pathname, response.status());
  });

  await withDeadline('DOMContentLoaded', page.goto(origin, { waitUntil: 'domcontentloaded' }), 8_000);
  await waitFor(
    'React root children',
    () => page.locator('#root').evaluate((element) => element.childElementCount > 0),
    8_000
  );
  const readyState = await page.evaluate(() => document.readyState);
  const rootChildCount = await page.locator('#root').evaluate((element) => element.childElementCount);
  assert.equal(readyState, 'complete', 'document did not finish loading');
  assert.ok(rootChildCount > 0, 'React did not mount into #root');
  assert.equal(responses.get('/src/main.tsx'), 200, 'main module was not delivered');
  assert.equal(responses.get('/src/App.tsx'), 200, 'App module was not delivered');
  assert.deepEqual(failures, { console: 0, page: 0, request: 0 }, 'browser observed a startup failure');
}

try {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    configFile,
    root
  );
  assert.ok(loaded, 'Vite did not load vite.config.ts');
  const config = loaded.config;
  assert.deepEqual(config.optimizeDeps?.entries, ['index.html'], 'dependency discovery must use only index.html');
  assert.deepEqual(
    config.optimizeDeps?.include,
    ['pdfjs-dist', 'tesseract-wasm'],
    'heavy lazy dependencies must remain explicit'
  );
  const ignored = config.server?.watch?.ignored;
  assert.ok(Array.isArray(ignored), 'watch ignores must be an explicit list');
  assert.ok(anymatch(ignored, path.join(root, 'src-tauri', 'src', 'main.rs')), 'src-tauri must stay ignored');
  assert.ok(
    anymatch(ignored, path.join(root, '.worktrees', 'other', 'src', 'main.tsx')),
    'nested worktrees must be ignored'
  );
  assert.ok(!anymatch(ignored, path.join(root, 'src', 'main.tsx')), 'normal source files must not be ignored');

  const port = await freePort();
  vite = await withDeadline(
    'Vite server creation',
    createServer({
      configFile,
      root,
      cacheDir: path.join(tempRoot, 'vite-cache'),
      server: {
        host: '127.0.0.1',
        port,
        strictPort: true,
        watch: { usePolling: true, interval: 100 },
      },
    }),
    10_000
  );
  await withDeadline('Vite listen', vite.listen(), 10_000);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal(await localStatus(`${origin}/`, 3_000), 200, 'root index request failed');
  assert.equal(await localStatus(`${origin}/src/main.tsx`, 3_000), 200, 'entry module request failed');
  await proveBrowser(origin);
  console.log('Vite control startup: PASS');
} finally {
  await browserContext?.close();
  await vite?.close();
  await rm(tempRoot, { recursive: true, force: true });
}
