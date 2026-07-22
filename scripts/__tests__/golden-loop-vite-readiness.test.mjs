import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startGoldenLoopVite } from '../golden-loop-vite-server.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverScript = path.join(repositoryRoot, 'scripts', 'golden-loop-vite-server.mjs');
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function fixture({ mode = 'ready', delayMs = 0 } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lantern-golden-loop.fixture-'));
  const sourceRoot = path.join(tempRoot, 'source');
  const cacheDir = path.join(tempRoot, 'vite-cache');
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await mkdir(cacheDir);
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(sourceRoot, 'node_modules'));
  await writeFile(path.join(sourceRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>');
  await writeFile(path.join(sourceRoot, 'src', 'main.tsx'), "void import('./App');\n");
  if (mode !== 'missing-app') {
    await writeFile(path.join(sourceRoot, 'src', 'App.tsx'), mode === 'transform-failure'
      ? 'this is not valid TypeScript = ;\n'
      : "import './delayed'; export default function App() { return null; }\n");
  }
  await writeFile(path.join(sourceRoot, 'src', 'delayed.ts'), 'export const delayed = true;\n');
  const responseMode = ['redirect', 'non-2xx'].includes(mode) ? mode : 'ready';
  await writeFile(path.join(sourceRoot, 'vite.config.ts'), `
import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: { entries: ['index.html'] },
  server: { warmup: { clientFiles: ['./src/delayed.ts'] } },
  plugins: [{
    name: 'golden-loop-readiness-fixture',
    async transform(code, id) {
      if (id.endsWith('/src/delayed.ts') && ${Number(delayMs)} > 0) {
        await new Promise((resolve) => setTimeout(resolve, ${Number(delayMs)}));
      }
      return code;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/' && ${JSON.stringify(responseMode)} === 'redirect') {
          response.writeHead(302, { location: '/elsewhere' }); response.end(); return;
        }
        if (request.url === '/' && ${JSON.stringify(responseMode)} === 'non-2xx') {
          response.writeHead(503); response.end(); return;
        }
        next();
      });
    },
  }],
});
`);
  return { tempRoot, sourceRoot, cacheDir, cleanup: () => rm(tempRoot, { recursive: true, force: true }) };
}

async function waitForLine(child, timeoutMs = 15_000) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const deadline = Date.now() + timeoutMs;
  while (!stdout.includes('\n') && child.exitCode === null && Date.now() < deadline) await pause(20);
  return { stdout, stderr: () => stderr };
}

test('a deliberately delayed App dependency prevents readiness from appearing early', async () => {
  const f = await fixture({ delayMs: 700 });
  const port = await freePort();
  const child = spawn(process.execPath, [serverScript, f.sourceRoot, '127.0.0.1', String(port), f.cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  try {
    await pause(200);
    assert.equal(stdout, '', 'readiness appeared while the App dependency was delayed');
    const started = Date.now();
    while (!stdout.includes('\n') && Date.now() - started < 15_000) await pause(20);
    assert.match(stdout, /^\{"schema":1,"kind":"lantern-golden-loop-vite-ready"/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await f.cleanup();
  }
  assert.equal(child.exitCode, 0);
});

for (const mode of ['transform-failure', 'missing-app', 'redirect', 'non-2xx']) {
  test(`${mode} cannot produce readiness`, async () => {
    const f = await fixture({ mode });
    const port = await freePort();
    let lifecycle;
    try {
      await assert.rejects(async () => {
        lifecycle = await startGoldenLoopVite({ sourceRoot: f.sourceRoot, host: '127.0.0.1', port, cacheDir: f.cacheDir });
      });
      assert.equal(lifecycle, undefined);
    } finally {
      await f.cleanup();
    }
  });
}

test('proxy variables and curl configuration cannot answer or redirect direct readiness probes', async () => {
  const f = await fixture();
  const port = await freePort();
  const previous = new Map();
  for (const [name, value] of Object.entries({
    http_proxy: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1',
    https_proxy: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    CURL_HOME: path.join(f.tempRoot, 'hostile-curl-home'),
  })) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  await mkdir(process.env.CURL_HOME);
  await writeFile(path.join(process.env.CURL_HOME, '.curlrc'), 'location\nproxy = http://127.0.0.1:1\n');
  let lifecycle;
  try {
    lifecycle = await startGoldenLoopVite({ sourceRoot: f.sourceRoot, host: '127.0.0.1', port, cacheDir: f.cacheDir });
    assert.equal(lifecycle.state.ready, true);
  } finally {
    await lifecycle?.shutdown();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await f.cleanup();
  }
});

test('shutdown after readiness is quiet, complete, and idempotent', async () => {
  const f = await fixture({ delayMs: 50 });
  const port = await freePort();
  const child = spawn(process.execPath, [serverScript, f.sourceRoot, '127.0.0.1', String(port), f.cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const processFailures = [];
  const onRejection = (error) => processFailures.push(error);
  process.on('unhandledRejection', onRejection);
  try {
    const output = await waitForLine(child);
    assert.match(output.stdout, /^\{"schema":1,"kind":"lantern-golden-loop-vite-ready"/);
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    const stderr = output.stderr();
    assert.equal(child.exitCode, 0, stderr);
    assert.doesNotMatch(stderr, /ERR_CLOSED_SERVER|AbortError|unhandled|restarted or closed/i);
    assert.deepEqual(processFailures, []);
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  } finally {
    process.off('unhandledRejection', onRejection);
    if (child.exitCode === null) child.kill('SIGKILL');
    await f.cleanup();
  }
});

test('programmatic shutdown settles once and closes exactly its own server', async () => {
  const f = await fixture();
  const port = await freePort();
  let lifecycle;
  try {
    lifecycle = await startGoldenLoopVite({ sourceRoot: f.sourceRoot, host: '127.0.0.1', port, cacheDir: f.cacheDir });
    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);
    assert.equal(lifecycle.state.closed, true);
    assert.equal(lifecycle.state.shutdownError, false);
    assert.equal(lifecycle.httpServer?.listening ?? false, false);
  } finally {
    await lifecycle?.shutdown();
    await f.cleanup();
  }
});

test('a second signal during shutdown revokes readiness and exits red without closing twice', async () => {
  const f = await fixture();
  const port = await freePort();
  const child = spawn(process.execPath, [serverScript, f.sourceRoot, '127.0.0.1', String(port), f.cacheDir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const output = await waitForLine(child);
    assert.match(output.stdout, /^\{"schema":1,"kind":"lantern-golden-loop-vite-ready"/);
    child.kill('SIGTERM');
    child.kill('SIGINT');
    await new Promise((resolve) => child.once('exit', resolve));
    assert.notEqual(child.exitCode, 0);
    assert.doesNotMatch(output.stderr(), /ERR_CLOSED_SERVER|AbortError|unhandled|restarted or closed/i);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await f.cleanup();
  }
});
