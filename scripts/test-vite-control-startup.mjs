#!/usr/bin/env node
/** Cold and warm control proof using the real repository Vite config and graph. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
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
  try {
    assert.equal(lifecycle.record.origin, `http://127.0.0.1:${port}`);
    assert.equal(lifecycle.line, `${JSON.stringify(lifecycle.record)}\n`);
    assert.equal(lifecycle.state.ready, true, `${label} did not publish readiness`);
    const graph = lifecycle.server.environments.client.moduleGraph;
    assert.ok(await graph.getModuleByUrl('/src/main.tsx'), `${label} did not warm main.tsx`);
    assert.ok(await graph.getModuleByUrl('/src/App.tsx'), `${label} did not warm App.tsx`);
    await lifecycle.server.environments.client.waitForRequestsIdle();
    assert.equal(lifecycle.state.viteError, false, `${label} logged a Vite error`);
  } finally {
    await lifecycle.shutdown();
  }
  assert.equal(lifecycle.state.closed, true, `${label} did not close its exact server`);
  assert.equal(lifecycle.httpServer?.listening ?? false, false, `${label} server still listens`);
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
