#!/usr/bin/env node
/** Cold and warm control proof using the real repository Vite config and graph. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { accessSync, constants as fsConstants, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createConnection, createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import anymatch from 'anymatch';
import { loadConfigFromFile } from 'vite';
import { startGoldenLoopVite } from './golden-loop-vite-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(root, 'vite.config.ts');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lantern-golden-loop.control-'));
const cacheDir = path.join(tempRoot, 'vite-cache');
const canonicalCacheMetadata = path.join(root, 'node_modules', '.vite', 'deps', '_metadata.json');
const beforeCanonicalCache = await readFile(canonicalCacheMetadata).catch(() => undefined);
const processFailures = [];
const onRejection = (error) => processFailures.push(error);
const onException = (error) => processFailures.push(error);
process.on('unhandledRejection', onRejection);
process.on('uncaughtException', onException);

const BROWSER_TIMEOUT_MS = 10_000;

function installedChromium() {
  for (const executable of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    try {
      accessSync(executable, fsConstants.X_OK);
      return executable;
    } catch {}
  }
  assert.fail('browser proof requires an installed Chrome or Chromium executable');
}

async function listenerAcceptsConnections(port) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (listening) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function proveRun(label) {
  const port = await freePort();
  const lifecycle = await startGoldenLoopVite({ sourceRoot: root, host: '127.0.0.1', port, cacheDir });
  let browser;
  let context;
  try {
    assert.equal(lifecycle.record.origin, `http://127.0.0.1:${port}`);
    assert.equal(lifecycle.line, `${JSON.stringify(lifecycle.record)}\n`);
    assert.equal(lifecycle.state.ready, true, `${label} did not publish readiness`);
    const graph = lifecycle.server.environments.client.moduleGraph;
    assert.ok(await graph.getModuleByUrl('/src/main.tsx'), `${label} did not warm main.tsx`);
    assert.ok(await graph.getModuleByUrl('/src/App.tsx'), `${label} did not warm App.tsx`);
    await lifecycle.server.environments.client.waitForRequestsIdle();
    assert.equal(lifecycle.state.viteError, false, `${label} logged a Vite error`);

    const origin = lifecycle.record.origin;
    const diagnostics = {
      consoleErrors: 0,
      pageErrors: 0,
      sameOriginRequestFailures: 0,
      blockedNonLoopbackRequests: 0,
      rootRendered: false,
      mainStatuses: [],
      appStatuses: [],
      contextClosed: false,
      browserClosed: false,
    };
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({
        executablePath: installedChromium(), headless: true, timeout: BROWSER_TIMEOUT_MS,
      });
      context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(BROWSER_TIMEOUT_MS);
      page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.consoleErrors += 1;
      });
      page.on('pageerror', () => { diagnostics.pageErrors += 1; });
      page.on('requestfailed', (request) => {
        try {
          if (new URL(request.url()).origin === origin) diagnostics.sameOriginRequestFailures += 1;
        } catch {
          diagnostics.sameOriginRequestFailures += 1;
        }
      });
      page.on('response', (response) => {
        const responseUrl = new URL(response.url());
        if (responseUrl.origin !== origin) return;
        if (responseUrl.pathname === '/src/main.tsx') diagnostics.mainStatuses.push(response.status());
        if (responseUrl.pathname === '/src/App.tsx') diagnostics.appStatuses.push(response.status());
      });
      await page.route('**/*', async (route) => {
        const requestUrl = new URL(route.request().url());
        if (['about:', 'blob:', 'data:'].includes(requestUrl.protocol)
          || (['http:', 'https:'].includes(requestUrl.protocol)
            && ['127.0.0.1', '::1', 'localhost'].includes(requestUrl.hostname))) {
          await route.continue();
          return;
        }
        diagnostics.blockedNonLoopbackRequests += 1;
        await route.abort('blockedbyclient');
      });

      const navigation = await page.goto(`${origin}/`, {
        waitUntil: 'domcontentloaded', timeout: BROWSER_TIMEOUT_MS,
      });
      assert.ok(navigation && navigation.status() >= 200 && navigation.status() < 300);
      await page.locator('#root').waitFor({ state: 'attached', timeout: BROWSER_TIMEOUT_MS });
      await page.waitForFunction(
        () => (document.querySelector('#root')?.childElementCount ?? 0) > 0,
        undefined,
        { timeout: BROWSER_TIMEOUT_MS },
      );
      diagnostics.rootRendered = true;
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      await lifecycle.server.environments.client.waitForRequestsIdle();

      assert.ok(diagnostics.mainStatuses.some((status) => status >= 200 && status < 300));
      assert.ok(diagnostics.appStatuses.some((status) => status >= 200 && status < 300));
      assert.equal(diagnostics.consoleErrors, 0);
      assert.equal(diagnostics.pageErrors, 0);
      assert.equal(diagnostics.sameOriginRequestFailures, 0);
      await context.close();
      diagnostics.contextClosed = true;
      context = undefined;
      await browser.close();
      diagnostics.browserClosed = true;
      browser = undefined;
    } catch {
      const bounded = JSON.stringify({
        label,
        consoleErrors: diagnostics.consoleErrors,
        pageErrors: diagnostics.pageErrors,
        sameOriginRequestFailures: diagnostics.sameOriginRequestFailures,
        blockedNonLoopbackRequests: diagnostics.blockedNonLoopbackRequests,
        rootRendered: diagnostics.rootRendered,
        mainStatuses: diagnostics.mainStatuses.slice(0, 8),
        appStatuses: diagnostics.appStatuses.slice(0, 8),
        contextClosed: diagnostics.contextClosed,
        browserClosed: diagnostics.browserClosed,
      });
      throw new Error(`real-browser React mount proof failed: ${bounded}`);
    } finally {
      await context?.close().catch(() => {});
      await browser?.close().catch(() => {});
    }
  } finally {
    await lifecycle.shutdown();
  }
  assert.equal(lifecycle.state.closed, true, `${label} did not close its exact server`);
  assert.equal(lifecycle.httpServer?.listening ?? false, false, `${label} server still listens`);
  assert.equal(await listenerAcceptsConnections(port), false, `${label} listener still accepts connections`);
}

try {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile, root);
  assert.ok(loaded, 'Vite did not load the repository config');
  assert.deepEqual(loaded.config.optimizeDeps?.entries, ['index.html']);
  assert.deepEqual(loaded.config.optimizeDeps?.include, ['pdfjs-dist', 'tesseract-wasm']);
  const ignored = loaded.config.server?.watch?.ignored;
  assert.ok(Array.isArray(ignored));
  assert.ok(anymatch(ignored, path.join(root, 'src-tauri', 'src', 'main.rs')));
  assert.ok(anymatch(ignored, path.join(root, '.worktrees', 'other', 'src', 'main.tsx')));
  assert.ok(!anymatch(ignored, path.join(root, 'src', 'main.tsx')));

  await mkdir(cacheDir);
  assert.deepEqual(await (await import('node:fs/promises')).readdir(cacheDir), [], 'cold cache was not empty');
  await proveRun('cold cache');
  const metadata = path.join(cacheDir, 'deps', '_metadata.json');
  assert.ok((await stat(metadata)).isFile(), 'cold run did not populate its isolated cache');
  const firstHash = createHash('sha256').update(readFileSync(metadata)).digest('hex');
  await proveRun('warm cache');
  assert.equal(createHash('sha256').update(readFileSync(metadata)).digest('hex'), firstHash,
    'warm run unexpectedly changed the stable dependency cache');
  const afterCanonicalCache = await readFile(canonicalCacheMetadata).catch(() => undefined);
  assert.deepEqual(afterCanonicalCache, beforeCanonicalCache, 'control run touched node_modules/.vite');
  assert.deepEqual(processFailures, [], 'startup or shutdown leaked an uncaught process failure');
  console.log('Vite cold/warm control startup: PASS');
} finally {
  process.off('unhandledRejection', onRejection);
  process.off('uncaughtException', onException);
  await rm(tempRoot, { recursive: true, force: true });
}
