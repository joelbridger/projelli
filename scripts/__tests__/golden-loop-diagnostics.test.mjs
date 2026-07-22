import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { promisify } from 'node:util';
import { createProgressReporter, classifyDiagnostic, safeArtifact, writeDiagnosticArtifact } from '../golden-loop-diagnostics.mjs';
import { createRendererReadiness } from '../golden-loop-driver.mjs';

const execFileAsync = promisify(execFile);

const testDirectory = () => path.join(os.tmpdir(), `golden-loop-diagnostic-test-${process.pid}-${Date.now()}`);

async function installedRecorder(fetchImpl = async () => ({ status: 200 })) {
  const source = await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8');
  const script = source.match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)?.[1];
  assert.ok(script, 'could not extract the installed initialization script');
  const listeners = new Map();
  const window = {
    location: { href: 'https://client-records.example/Clients/Jane-Doe/Plan.docx?token=secret#fragment' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    console: undefined,
  };
  const console = { error() {} };
  window.fetch = fetchImpl;
  vm.runInNewContext(script, { window, console, URL });
  return { window, listeners, console };
}

test('installed early recorder preserves the browser fetch receiver', async () => {
  let window;
  const receiverSensitiveFetch = function () {
    if (this !== window) throw new TypeError('Illegal invocation');
    return Promise.resolve({ status: 200 });
  };
  ({ window } = await installedRecorder(receiverSensitiveFetch));

  const response = await window.fetch('/src/main.tsx');
  assert.equal(response.status, 200);
});

test('installed early recorder retains only categories, safe locations, and HTTP status', async () => {
  const { window, listeners, console } = await installedRecorder();
  const secret = 'Bearer very-secret-client-content';
  listeners.get('error')({ target: window, message: `Failed to import ${secret}`, filename: 'https://client-records.example/src/Jane-Doe/Plan.tsx?token=bad#x' });
  listeners.get('error')({ target: window, message: secret, error: { name: 'TypeError' }, filename: 'https://outside.example/client@example.test/Plan.docx?token=bad' });
  console.error(secret);
  listeners.get('unhandledrejection')({ reason: new Error(secret) });
  listeners.get('error')({ target: { tagName: 'SCRIPT', src: 'https://cdn.test/client-token.js?secret=bad' } });
  window.fetch = async () => { throw new Error(secret); };
  // Re-install with the failing fetch so the actual wrapper executes its reject path.
  const rejected = await installedRecorder();
  rejected.window.fetch = async () => { throw new Error(secret); };
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: rejected.window, console: rejected.console, URL });
  await assert.rejects(rejected.window.fetch('https://api.test/client?token=bad'));
  const http = await installedRecorder();
  http.window.fetch = async () => ({ status: 404 });
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: http.window, console: http.console, URL });
  await http.window.fetch('https://api.test/client?token=bad');
  const http500 = await installedRecorder();
  http500.window.fetch = async () => ({ status: 500 });
  vm.runInNewContext((await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8')).match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)[1], { window: http500.window, console: http500.console, URL });
  await http500.window.fetch('https://api.test/client?token=bad');

  const directory = testDirectory();
  try {
    await mkdir(directory, { mode: 0o777 });
    await chmod(directory, 0o777);
    const result = await writeDiagnosticArtifact({
      phase: 'write',
      renderer: { url: window.location.href, pageUrl: 'http://localhost:5174/', rootPresent: true, rootHasChildren: false, dom: { elementCount: 12, tags: ['div', 'script', 'client-secret'] } },
      events: {
        ...window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__,
        pageErrors: [...window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.pageErrors, { category: 'console-error', location: 'https://client@example.test/Secret.docx' }],
        consoleErrors: [{ category: 'forged-client-category', location: 'https://client@example.test/Secret.docx' }],
        unhandledRejections: [{ category: 'type-error', location: 'https://client@example.test/Secret.docx' }],
        resourceFailures: [{ category: 'http-response-failure', location: 'https://client@example.test/Secret.docx' }],
        networkFailures: [...rejected.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http500.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures],
      },
    }, directory);
    const encoded = await readFile(result.path, 'utf8');
    const saved = JSON.parse(encoded);
    assert.deepEqual({ sameOrigin: saved.renderer.sameOrigin, locationClass: saved.renderer.locationClass }, { sameOrigin: false, locationClass: 'other' });
    assert.equal(saved.classification, 'javascript-module-import-error');
    assert.deepEqual(saved.events.networkFailures.map(({ category, status }) => ({ category, status })), [
      { category: 'fetch-rejected', status: undefined },
      { category: 'http-response-failure', status: 404 },
      { category: 'http-response-failure', status: 500 },
    ]);
    assert.equal(saved.renderer.dom.tags.includes('other'), true);
    assert.equal(saved.events.consoleErrors[0].category, 'console-error');
    assert.equal(saved.events.pageErrors.at(-1).category, 'javascript-error');
    assert.equal(saved.events.unhandledRejections[0].category, 'unhandled-rejection');
    assert.equal(saved.events.resourceFailures[0].category, 'resource-load-failure');
    assert.deepEqual(saved.events.pageErrors.map(({ sameOrigin, locationClass }) => ({ sameOrigin, locationClass })), [
      { sameOrigin: true, locationClass: 'app-module' },
      { sameOrigin: false, locationClass: 'other' },
      { sameOrigin: false, locationClass: 'other' },
    ]);
    for (const forbidden of [secret, 'client-records.example', 'client@example.test', 'Jane-Doe', 'Plan.docx', '?token=', '#fragment', 'forged-client-category', '/src/']) {
      assert.equal(encoded.includes(forbidden), false, `artifact retained ${forbidden}`);
    }
    assert.equal(/"(?:url|origin|hostname|path|query|fragment|location|error|stack|message|value|reason|headers|body|storage|token)"\s*:/.test(encoded), false);
    assert.equal(result.sha256, createHash('sha256').update(encoded).digest('hex'));
    assert.equal((await stat(result.path)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('empty React root is classified from the actual renderer snapshot shape', () => {
  assert.equal(classifyDiagnostic({}, { rootPresent: true, rootHasChildren: false }, 'write'), 'react-mount-did-not-run');
  assert.equal(safeArtifact({ phase: 'write', renderer: { rootPresent: true, rootHasChildren: false } }).classification, 'react-mount-did-not-run');
});

test('every non-renderer failure class writes a bounded surviving artifact', async () => {
  const directory = testDirectory();
  try {
    for (const [phase, classification] of Object.entries({
      preflight: 'runner-preflight-failure',
      'product-gate-build': 'product-gate-build-failure', 'product-gate-provenance': 'product-gate-provenance-failure',
      'diagnostic-writer-validation': 'diagnostic-writer-validation-failure', 'directory-creation': 'directory-creation-failure',
      'port-selection': 'port-selection-failure', 'pid-read': 'pid-read-failure', 'driver-startup': 'driver-startup-failure',
      'vite-startup': 'vite-startup-failure', launcher: 'launcher-failure', 'bridge-health': 'bridge-health-failure',
      'app-exit': 'app-exit-failure', 'renderer-dispatch': 'renderer-dispatch-timeout',
      'later-driver': 'later-driver-failure', restart: 'restart-failure',
    })) {
      const result = await writeDiagnosticArtifact({ phase }, directory);
      const encoded = await readFile(result.path, 'utf8');
      assert.equal(result.artifact.classification, classification);
      assert.equal(result.artifact.renderer.locationClass, 'unavailable');
      assert.deepEqual(result.artifact.renderer, { available: false, locationClass: 'unavailable' });
      assert.equal(encoded.includes('workspace'), false);
      assert.equal(result.sha256, createHash('sha256').update(encoded).digest('hex'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('progress reporter writes only monotonic fixed phases and keeps private file permissions', async () => {
  const root = testDirectory();
  const target = path.join(root, 'progress');
  await mkdir(root, { mode: 0o700 });
  try {
    const report = createProgressReporter(target);
    await report('bridge-healthy');
    assert.equal(await readFile(target, 'utf8'), 'bridge-healthy\n');
    await report('renderer-ready');
    assert.equal(await readFile(`${target}.1`, 'utf8'), 'renderer-ready\n');
    await report('renderer-ready');
    await report('later-driver');
    assert.equal(await readFile(`${target}.2`, 'utf8'), 'later-driver\n');
    assert.equal((await stat(`${target}.2`)).mode & 0o777, 0o600);
    await assert.rejects(report('renderer-ready'), /progress publication refused/);
    await assert.rejects(report('client-name-or-path'), /progress publication refused/);
    assert.equal(await readFile(`${target}.2`, 'utf8'), 'later-driver\n');
    assert.deepEqual((await readdir(root)).sort(), ['progress', 'progress.1', 'progress.2']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('progress reporter atomically refuses regular files and symlinks planted during installation', async () => {
  for (const planted of ['regular-file', 'symlink']) {
    const root = `${testDirectory()}-install-race-${planted}`;
    const target = path.join(root, 'private-client-secret-progress');
    const victim = path.join(root, 'private-client-secret-victim');
    let reporterTemporary;
    await mkdir(root, { mode: 0o700 });
    await writeFile(victim, 'original-link-target-bytes');
    const installNoReplace = async (temporaryPath, finalPath) => {
      reporterTemporary = temporaryPath;
      if (planted === 'symlink') await symlink(victim, finalPath);
      else await writeFile(finalPath, 'original-planted-bytes');
      await link(temporaryPath, finalPath);
    };
    try {
      let refusal;
      await assert.rejects(
        createProgressReporter(target, { installNoReplace })('bridge-healthy'),
        (error) => {
          refusal = error;
          assert.equal(error.message, 'progress publication refused');
          assert.equal(error.message.includes(root), false);
          assert.equal(error.message.includes('original-planted-bytes'), false);
          assert.equal(error.message.includes(victim), false);
          return true;
        },
      );
      assert.equal(await readFile(victim, 'utf8'), 'original-link-target-bytes');
      if (planted === 'symlink') {
        assert.equal((await lstat(target)).isSymbolicLink(), true);
        assert.equal(await readlink(target), victim);
      } else {
        assert.equal(await readFile(target, 'utf8'), 'original-planted-bytes');
      }
      await assert.rejects(lstat(reporterTemporary), { code: 'ENOENT' });
      assert.deepEqual((await readdir(root)).sort(),
        ['private-client-secret-progress', 'private-client-secret-victim']);
      const diagnostic = JSON.stringify(safeArtifact({
        phase: 'write',
        renderer: { snapshotError: refusal.message },
      }));
      for (const privateValue of [root, target, victim, 'original-planted-bytes', 'original-link-target-bytes']) {
        assert.equal(diagnostic.includes(privateValue), false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('progress reporter refuses planted targets and temporary files without changing their bytes or links', async () => {
  for (const planted of ['target-file', 'target-symlink', 'temporary-file', 'temporary-symlink']) {
    const root = `${testDirectory()}-${planted}`;
    const target = path.join(root, 'progress');
    const temporary = `${target}.tmp`;
    const victim = path.join(root, 'victim');
    await mkdir(root, { mode: 0o700 });
    await writeFile(victim, 'victim-secret-bytes');
    const plantedPath = planted.startsWith('target') ? target : temporary;
    if (planted.endsWith('symlink')) await symlink(victim, plantedPath);
    else await writeFile(plantedPath, 'planted-secret-bytes');
    try {
      const plantedBefore = planted.endsWith('symlink') ? await lstat(plantedPath) : undefined;
      await assert.rejects(createProgressReporter(target)('bridge-healthy'), /progress publication refused/);
      assert.equal(await readFile(victim, 'utf8'), 'victim-secret-bytes', planted);
      if (planted.endsWith('symlink')) {
        assert.equal((await lstat(plantedPath)).isSymbolicLink(), true, planted);
        assert.equal((await lstat(plantedPath)).ino, plantedBefore.ino, planted);
      } else {
        assert.equal(await readFile(plantedPath, 'utf8'), 'planted-secret-bytes', planted);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('renderer readiness is sticky across repeated calls with and without progress output', async () => {
  for (const withProgress of [false, true]) {
    const root = `${testDirectory()}-readiness-${withProgress}`;
    await mkdir(root, { mode: 0o700 });
    try {
      let healthCalls = 0;
      let evalCalls = 0;
      const report = createProgressReporter(withProgress ? path.join(root, 'progress') : undefined);
      const waitForRenderer = createRendererReadiness({
        healthRequest: async () => { healthCalls += 1; },
        readinessEvaluate: async () => {
          evalCalls += 1;
          return { hasTauriInvoke: true, readyState: 'complete', rootHasChildren: true };
        },
        publishProgress: report,
        readinessTimeoutMs: 1_200,
      });
      await waitForRenderer();
      await waitForRenderer();
      assert.equal(healthCalls, 1, `progress=${withProgress}`);
      assert.equal(evalCalls, 1, `progress=${withProgress}`);
      if (withProgress) assert.equal(await readFile(path.join(root, 'progress.1'), 'utf8'), 'renderer-ready\n');
      else assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('renderer readiness gets its full post-health deadline and never accepts an empty React root', async () => {
  let now = 0;
  const healthDeadlines = [];
  const readinessCalls = [];
  const waitForRenderer = createRendererReadiness({
    healthRequest: async (deadlineMs) => {
      healthDeadlines.push(deadlineMs);
      now += 1_500;
    },
    readinessEvaluate: async (deadlineMs, operationTimeoutMs) => {
      readinessCalls.push({ deadlineMs, operationTimeoutMs });
      if (readinessCalls.length === 1) {
        now += 2_500;
        return { hasTauriInvoke: true, readyState: 'interactive', rootHasChildren: false };
      }
      return { hasTauriInvoke: true, readyState: 'complete', rootHasChildren: true };
    },
    healthTimeoutMs: 2_000,
    readinessTimeoutMs: 4_000,
    now: () => now,
    pause: async (milliseconds) => { now += milliseconds; },
  });

  await waitForRenderer();

  assert.deepEqual(healthDeadlines, [2_000]);
  assert.deepEqual(readinessCalls, [
    { deadlineMs: 5_500, operationTimeoutMs: 2_000 },
    { deadlineMs: 5_500, operationTimeoutMs: 400 },
  ]);
  assert.ok(readinessCalls.every(({ operationTimeoutMs }) => operationTimeoutMs >= 100));
});

test('real driver preserves a native eval budget after slow health and waits for a mounted React root', async () => {
  const root = `${testDirectory()}-real-readiness-path`;
  const workspace = path.join(root, 'workspace');
  const documentName = 'Regression Document';
  const documentPath = `Golden Loop Client/${documentName}.docx`;
  const sockets = new Set();
  const evalQueryStrings = [];
  let evalRequests = 0;
  let healthCompletedAt;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (result) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result }));
    };
    if (url.pathname === '/health') {
      setTimeout(() => {
        healthCompletedAt = Date.now();
        send(undefined);
      }, 500);
      return;
    }
    if (url.pathname === '/click') {
      send(true);
      return;
    }
    if (url.pathname !== '/eval') {
      response.writeHead(404).end();
      return;
    }

    evalQueryStrings.push(url.search);
    evalRequests += 1;
    if (evalRequests === 1) {
      send({ hasTauriInvoke: true, readyState: 'complete', rootHasChildren: false });
      return;
    }
    if (evalRequests === 2) {
      send({ hasTauriInvoke: true, readyState: 'complete', rootHasChildren: true });
      return;
    }

    const routeResults = new Map([
      [3, true],
      [4, false],
      [5, 'spine-client-row-regression'],
      [6, false],
      [7, true],
      [8, `crm-document-card-${documentPath}`],
      [9, false],
      [10, true],
      [11, true],
      [12, true],
    ]);
    send(routeResults.get(evalRequests) ?? true);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await mkdir(path.dirname(path.join(workspace, documentPath)), { recursive: true });
  await writeFile(path.join(workspace, documentPath), 'test document');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const startedAt = Date.now();
  try {
    let result;
    try {
      result = await execFileAsync(
        process.execPath,
        [new URL('../golden-loop-driver.mjs', import.meta.url).pathname, 'assert', String(port), workspace, documentName],
        {
          env: {
            ...process.env,
            GOLDEN_LOOP_HEALTH_BOUND_MS: '800',
            GOLDEN_LOOP_READINESS_BOUND_MS: '1400',
            GOLDEN_LOOP_DRIVER_TIMEOUT_MS: '2500',
            GOLDEN_LOOP_DIAGNOSTIC_DIR: path.join(root, 'diagnostics'),
          },
          timeout: 5_000,
        },
      );
    } catch {
      assert.fail(`the real driver route failed after ${evalRequests} eval requests`);
    }

    assert.match(result.stdout, /^PASS persistence:/m);
    assert.doesNotMatch(result.stderr, /bound=0ms/);
    assert.ok(healthCompletedAt - startedAt >= 450, 'health did not consume the old shared readiness budget');
    assert.ok(startedAt + 1_400 - healthCompletedAt < 1_100, 'the old shared deadline retained enough transport and native time');
    assert.ok(evalQueryStrings.length >= 2, 'the empty root was accepted before the mounted-root response');
    assert.equal(evalRequests, 12, 'the driver did not complete the expected route after readiness');
    for (const queryString of evalQueryStrings) {
      const query = new URLSearchParams(queryString);
      const nativeBudgetMs = Number(query.get('timeout_ms'));
      assert.ok(query.has('js'), 'an eval request omitted its script');
      assert.ok(Number.isFinite(nativeBudgetMs) && nativeBudgetMs >= 100, 'an eval request lacked a usable native budget');
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

async function writeExecutable(target, source) {
  await writeFile(target, source);
  await chmod(target, 0o700);
}

async function shellFunctionPrefix() {
  const source = await readFile(new URL('../golden-loop.sh', import.meta.url), 'utf8');
  return source.slice(0, source.indexOf('\ncleanup() {'));
}

async function runStalledBridgeDriver(stallPath, { stallBody = false } = {}) {
  const root = testDirectory();
  const workspace = path.join(root, 'workspace');
  const diagnostics = path.join(root, 'diagnostics');
  const sockets = new Set();
  const server = createServer((request, response) => {
    if (request.url?.startsWith(stallPath)) {
      if (stallBody) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"ok":true,"result":');
      }
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: { hasTauriInvoke: true, readyState: 'complete' } }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await mkdir(workspace, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const startedAt = Date.now();
  try {
    let failure;
    try {
      await execFileAsync(process.execPath, [new URL('../golden-loop-driver.mjs', import.meta.url).pathname, 'write', String(port), workspace, 'Client Query Secret'], {
        env: { ...process.env, GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics },
        timeout: 10_000,
      });
    } catch (error) { failure = error; }
    assert.ok(failure, `${stallPath} stall unexpectedly passed`);
    const stderr = String(failure.stderr);
    assert.match(stderr, /GOLDEN LOOP DIAGNOSTIC: path=.* sha256=[a-f0-9]{64}/);
    assert.match(stderr, new RegExp(`endpoint=${stallPath} bound=${stallPath === '/health' ? 2000 : 3000}ms`));
    assert.equal(stderr.includes('Client Query Secret'), false, 'diagnostic leaked query-derived content');
    assert.ok(Date.now() - startedAt < 8_000, `${stallPath} stall waited for the outer controller`);
    const names = await (await import('node:fs/promises')).readdir(diagnostics);
    assert.equal(names.length, 1, 'driver did not write its own diagnostic');
    const artifact = await readFile(path.join(diagnostics, names[0]), 'utf8');
    assert.equal(artifact.includes('Client Query Secret'), false, 'artifact leaked query-derived content');
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test('bridge fetch timeouts are bounded, diagnostic, and query-safe during health and eval stalls', async () => {
  await runStalledBridgeDriver('/health');
  await runStalledBridgeDriver('/eval');
  await runStalledBridgeDriver('/eval', { stallBody: true });
});

test('readiness uses one absolute deadline so its final bridge poll cannot extend the window', async () => {
  const root = testDirectory();
  const workspace = path.join(root, 'workspace');
  const diagnostics = path.join(root, 'diagnostics');
  const sockets = new Set();
  let evalRequests = 0;
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/health')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    evalRequests += 1;
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result: { hasTauriInvoke: true, readyState: 'loading' } }));
    }, 700);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await mkdir(workspace, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const startedAt = Date.now();
  try {
    let failure;
    try {
      await execFileAsync(process.execPath, [
        new URL('../golden-loop-driver.mjs', import.meta.url).pathname,
        'assert', String(server.address().port), workspace, 'Private Client Query',
      ], {
        env: {
          ...process.env,
          GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics,
          GOLDEN_LOOP_HEALTH_BOUND_MS: '100',
          GOLDEN_LOOP_READINESS_BOUND_MS: '1800',
          GOLDEN_LOOP_SNAPSHOT_BOUND_MS: '100',
          GOLDEN_LOOP_ARTIFACT_BOUND_MS: '300',
        },
        timeout: 5_000,
      });
    } catch (error) { failure = error; }
    assert.ok(failure);
    assert.ok(Date.now() - startedAt < 3_000, 'last readiness poll extended beyond the absolute deadline');
    assert.ok(evalRequests <= 2, `unexpected readiness retry after deadline: ${evalRequests}`);
    assert.doesNotMatch(String(failure.stderr), /bound=0ms/, 'readiness dispatched a bridge request without a usable budget');
    assert.equal(String(failure.stderr).includes('Private Client Query'), false);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('post-KILL cleanup stays red and retains ownership when a descendant remains', async () => {
  const root = testDirectory();
  const prefix = path.join(root, 'golden-loop-functions.sh');
  const harness = path.join(root, 'post-kill.sh');
  await mkdir(root);
  await writeFile(prefix, await shellFunctionPrefix());
  await writeExecutable(harness, `#!/usr/bin/env bash
source "$1"
TERM_GRACE_SECONDS=0
DRIVER_PID=4242
DRIVER_PGID=4242
DRIVER_GROUP_START_TIME=owned-start
checks=0
driver_group_is_owned() { return 0; }
driver_group_has_live_descendants() {
  checks=$((checks + 1))
  case "$checks" in 1|3) return 1 ;; *) return 0 ;; esac
}
kill() { return 0; }
sleep() { :; }
wait() { printf 'reaped\\n'; return 0; }
set +e
stop_driver_group
status=$?
printf 'status=%s pid=%s pgid=%s start=%s checks=%s\\n' \
  "$status" "$DRIVER_PID" "$DRIVER_PGID" "$DRIVER_GROUP_START_TIME" "$checks"
`);
  try {
    const { stdout, stderr } = await execFileAsync('bash', [harness, prefix]);
    assert.match(stdout, /reaped/);
    assert.match(stdout, /status=1 pid=4242 pgid=4242 start=owned-start checks=4/);
    assert.match(stderr, /remained live after KILL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed startup ownership capture reaps only the unreaped direct leader', async () => {
  const root = testDirectory();
  const prefix = path.join(root, 'golden-loop-functions.sh');
  const harness = path.join(root, 'startup-capture.sh');
  const driver = path.join(root, 'driver.mjs');
  const signals = path.join(root, 'signals');
  await mkdir(root);
  await writeFile(prefix, await shellFunctionPrefix());
  await writeFile(driver, 'setInterval(() => {}, 1000);\n');
  await writeExecutable(harness, `#!/usr/bin/env bash
source "$1"
TEMP_ROOT="$2"
DRIVER="$3"
SIGNAL_LOG="$4"
TIMEOUT_SECONDS=1
process_start_time() { return 1; }
kill() {
  printf '%s\\n' "$*" >>"$SIGNAL_LOG"
  builtin kill "$@"
}
set +e
run_driver write
status=$?
printf 'status=%s pid=%s pgid=%s start=%s\\n' \
  "$status" "$DRIVER_PID" "$DRIVER_PGID" "$DRIVER_GROUP_START_TIME"
`);
  try {
    const { stdout } = await execFileAsync('bash', [harness, prefix, root, driver, signals], { timeout: 10_000 });
    assert.match(stdout, /status=1 pid= pgid= start=/);
    const sentSignals = (await readFile(signals, 'utf8')).trim().split('\n');
    assert.equal(sentSignals.length, 2);
    for (const signal of sentSignals) {
      assert.match(signal, /^-(?:TERM|KILL) [1-9][0-9]*$/, `unsafe signal: ${signal}`);
      assert.doesNotMatch(signal, / --? -[1-9]/, `group signal lacked ownership: ${signal}`);
    }
    const leaderPid = Number(sentSignals[0].split(' ').at(-1));
    assert.throws(() => process.kill(leaderPid, 0), { code: 'ESRCH' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function runShellFailure(mode, { expectSuccess = false, timingOverrides = {} } = {}) {
  const root = testDirectory();
  const bin = path.join(root, 'bin');
  const repo = path.join(root, 'repo');
  const diagnostics = path.join(root, 'diagnostics');
  const temporaryDirectory = path.join(root, 'tmp');
  await mkdir(path.join(repo, 'src-tauri'), { recursive: true });
  await mkdir(path.join(repo, 'node_modules'));
  await mkdir(bin);
  await mkdir(temporaryDirectory);
  await writeFile(path.join(repo, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ build: { devUrl: 'http://127.0.0.1:4173/' } }));
  const app = path.join(root, 'app');
  const launcher = path.join(root, 'launcher');
  const driver = path.join(root, 'driver.mjs');
  const invalidWriter = path.join(root, 'invalid-writer.mjs');
  const failingWriter = path.join(root, 'failing-writer.mjs');
  await writeExecutable(app, '#!/usr/bin/env bash\nexit 0\n');
  await writeExecutable(path.join(bin, 'git'), `#!/usr/bin/env bash
case " $* " in
  *" rev-parse HEAD "*) echo 0123456789012345678901234567890123456789 ;;
  *" status --porcelain "*) : ;;
  *) exit 2 ;;
esac
`);
  await writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash
url="\${!#}"
if [[ "$url" == */src/main.tsx ]]; then
  printf '200'
  exit 0
fi
if [[ "$url" == *health* ]]; then
  [[ "$GOLDEN_LOOP_TEST_MODE" == bridge-health || "$GOLDEN_LOOP_TEST_MODE" == app-exit ]] && exit 1
  exit 0
fi
[[ "$GOLDEN_LOOP_TEST_MODE" == vite-startup ]] && exit 1
count=0; [[ -f "$GOLDEN_LOOP_TEST_CURL_COUNT" ]] && count="$(<"$GOLDEN_LOOP_TEST_CURL_COUNT")"
count=$((count + 1)); echo "$count" >"$GOLDEN_LOOP_TEST_CURL_COUNT"
[[ "$count" -eq 1 ]] && exit 1
exit 0
`);
  await writeExecutable(path.join(bin, 'npm'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == vite-startup ]] && exit 1
exec sleep 30
`);
  await writeExecutable(path.join(bin, 'python3'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == port-selection ]] && exit 1
echo 45678
`);
  await writeExecutable(path.join(bin, 'date'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == unexpected-trap ]] && exit 7
exec /usr/bin/date "$@"
`);
  await writeExecutable(path.join(bin, 'mkdir'), `#!/usr/bin/env bash
if [[ "$GOLDEN_LOOP_TEST_MODE" == directory-creation && " $* " == *"/workspace"* ]]; then exit 1; fi
exec /usr/bin/mkdir "$@"
`);
  await writeExecutable(path.join(bin, 'cat'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_TEST_MODE" == pid-read && "\${1:-}" == *app.pid ]] && exit 1
exec /usr/bin/cat "$@"
`);
  await writeExecutable(launcher, `#!/usr/bin/env bash
set -euo pipefail
count=0; [[ -f "$GOLDEN_LOOP_TEST_LAUNCH_COUNT" ]] && count="$(<"$GOLDEN_LOOP_TEST_LAUNCH_COUNT")"
count=$((count + 1)); echo "$count" >"$GOLDEN_LOOP_TEST_LAUNCH_COUNT"
[[ ("$GOLDEN_LOOP_TEST_MODE" == launcher-failure || "$GOLDEN_LOOP_TEST_MODE" == diagnostic-write-failure) && "$count" -eq 1 ]] && exit 2
[[ "$GOLDEN_LOOP_TEST_MODE" == restart && "$count" -eq 2 ]] && exit 2
if [[ "$GOLDEN_LOOP_TEST_MODE" == app-exit ]]; then echo 999999 >"$LANTERN_APP_PID_FILE"; exit 0; fi
setsid sleep 30 >/dev/null 2>&1 &
echo $! >"$LANTERN_APP_PID_FILE"
`);
  await writeExecutable(driver, `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = await import('node:fs');
const mode = process.env.GOLDEN_LOOP_TEST_MODE;
const progress = process.env.GOLDEN_LOOP_DRIVER_PROGRESS_FILE;
const phases = ['bridge-healthy', 'renderer-ready', 'later-driver'];
const publish = (value) => {
  const index = phases.indexOf(value);
  const target = index === 0 ? progress : progress + '.' + index;
  writeFileSync(target, value + '\\n', { mode: 0o600, flag: 'wx' });
};
if (mode === 'controller-success') {
  appendFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_CALLS, process.argv[2] + '\\n');
  publish('bridge-healthy'); publish('renderer-ready'); publish('later-driver');
  process.exit(0);
}
if (mode === 'driver-no-progress') setInterval(() => {}, 1_000);
if (mode === 'driver-bridge-stall') { publish('bridge-healthy'); setInterval(() => {}, 1_000); }
if (mode === 'driver-renderer-stall') { publish('renderer-ready'); setInterval(() => {}, 1_000); }
if (mode === 'driver-later-stall') { publish('later-driver'); setInterval(() => {}, 1_000); }
if (mode === 'driver-fast-after-ready') { publish('renderer-ready'); process.exit(7); }
if (mode === 'driver-artifact-hang') {
  setTimeout(() => writeFileSync(process.env.GOLDEN_LOOP_TEST_ARTIFACT_READY, 'ready'), 900);
  setInterval(() => {}, 1_000);
}
if (mode === 'driver-slow-ready-failure') {
  setTimeout(() => { publish('renderer-ready'); process.exit(7); }, 900);
  setInterval(() => {}, 1_000);
}
if (process.env.GOLDEN_LOOP_TEST_MODE === 'driver-startup') process.exit(1);
if (process.env.GOLDEN_LOOP_TEST_MODE === 'driver-timeout') {
  const { spawn } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const processIdentity = () => {
    const stat = readFileSync(\`/proc/\${process.pid}/stat\`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\\s+/);
    const group = Number(fields[2]);
    const leaderStat = readFileSync(\`/proc/\${group}/stat\`, 'utf8');
    const leaderFields = leaderStat.slice(leaderStat.lastIndexOf(') ') + 2).trim().split(/\\s+/);
    return { group, leaderStartTime: leaderFields[19] };
  };
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_PID, String(process.pid));
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000)'], {
    stdio: 'ignore',
  });
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID, String(child.pid));
  writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE, JSON.stringify(processIdentity()));
  process.on('SIGTERM', () => {
    writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM, JSON.stringify(processIdentity()));
    setTimeout(() => {
      writeFileSync(process.env.GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE, JSON.stringify(processIdentity()));
    }, 2_000);
  });
  setInterval(() => {}, 1_000);
}
`);
  await writeFile(invalidWriter, 'this is not valid JavaScript');
  await writeFile(failingWriter, `if (process.argv[2] === '--validate') process.exit(0); process.exit(9);`);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GOLDEN_LOOP_TEST_MODE: mode,
    GOLDEN_LOOP_TEST_CURL_COUNT: path.join(root, 'curl-count'),
    GOLDEN_LOOP_TEST_LAUNCH_COUNT: path.join(root, 'launch-count'),
    GOLDEN_LOOP_TEST_DRIVER_PID: path.join(root, 'driver-pid'),
    GOLDEN_LOOP_TEST_DRIVER_CHILD_PID: path.join(root, 'driver-child-pid'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE: path.join(root, 'driver-leader-before.json'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM: path.join(root, 'driver-leader-at-term.json'),
    GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE: path.join(root, 'driver-leader-late.json'),
    GOLDEN_LOOP_TEST_DRIVER_CALLS: path.join(root, 'driver-calls'),
    GOLDEN_LOOP_TEST_ARTIFACT_READY: path.join(root, 'artifact-ready'),
    GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics,
    GOLDEN_LOOP_LAUNCHER: launcher,
    GOLDEN_LOOP_DRIVER: driver,
    GOLDEN_LOOP_TIMEOUT_SECONDS: '1',
    GOLDEN_LOOP_HEALTH_BOUND_MS: '50',
    GOLDEN_LOOP_READINESS_BOUND_MS: '200',
    GOLDEN_LOOP_SNAPSHOT_BOUND_MS: '100',
    GOLDEN_LOOP_ARTIFACT_BOUND_MS: '100',
    GOLDEN_LOOP_DRIVER_CLEANUP_BOUND_MS: '100',
    GOLDEN_LOOP_DEADLINE_MARGIN_MS: '100',
    GOLDEN_LOOP_TERM_GRACE_SECONDS: '3',
    TMPDIR: temporaryDirectory,
    ...(mode === 'diagnostic-writer-validation' ? { GOLDEN_LOOP_DIAGNOSTIC_WRITER: invalidWriter } : {}),
    ...(mode === 'diagnostic-write-failure' ? { GOLDEN_LOOP_DIAGNOSTIC_WRITER: failingWriter } : {}),
    ...timingOverrides,
  };
  try {
    let failure;
    let success;
    try {
      success = await execFileAsync('bash', [new URL('../golden-loop.sh', import.meta.url).pathname, repo, app], {
        env,
        timeout: mode === 'driver-timeout' ? 20_000 : 10_000,
      });
    } catch (error) {
      failure = error;
    }
    if (expectSuccess) {
      assert.equal(failure, undefined, failure?.stderr);
      assert.match(success.stdout, /GOLDEN LOOP PASS/);
      return (await readFile(env.GOLDEN_LOOP_TEST_DRIVER_CALLS, 'utf8')).trim().split('\n');
    }
    assert.ok(failure, `${mode} unexpectedly turned green`);
    assert.notEqual(failure.code, 0);
    const names = await (await import('node:fs/promises')).readdir(diagnostics);
    assert.ok(names.length >= 1, `${mode} left no artifact`);
    const artifact = JSON.parse(await readFile(path.join(diagnostics, names.at(-1)), 'utf8'));
    assert.match(failure.stderr, /GOLDEN LOOP DIAGNOSTIC: path=.* sha256=[a-f0-9]{64} classification=/);
    if (mode === 'driver-artifact-hang') {
      assert.equal(await readFile(env.GOLDEN_LOOP_TEST_ARTIFACT_READY, 'utf8'), 'ready');
    }
    if (mode === 'driver-timeout') {
      const driverPid = Number(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_PID, 'utf8'));
      const childPid = Number(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID, 'utf8'));
      const leaderBefore = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_BEFORE, 'utf8'));
      const leaderAtTerm = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_AT_TERM, 'utf8'));
      const leaderLate = JSON.parse(await readFile(env.GOLDEN_LOOP_TEST_DRIVER_LEADER_LATE, 'utf8'));
      assert.notEqual(leaderBefore.group, driverPid, 'driver unexpectedly owned its process group');
      assert.deepEqual(leaderAtTerm, leaderBefore, 'TERM changed the owned group leader');
      assert.deepEqual(leaderLate, leaderBefore, 'owned group leader did not survive the TERM grace period');
      assert.throws(() => process.kill(leaderBefore.group, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(driverPid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
      assert.deepEqual(await (await import('node:fs/promises')).readdir(temporaryDirectory), []);
    }
    return artifact;
  } finally {
    if (mode === 'driver-timeout') {
      for (const pidFile of [env.GOLDEN_LOOP_TEST_DRIVER_PID, env.GOLDEN_LOOP_TEST_DRIVER_CHILD_PID]) {
        try { process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL'); } catch (error) {
          if (error.code !== 'ESRCH' && error.code !== 'ENOENT') throw error;
        }
      }
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('real shell routes every injected early failure to a red, bounded artifact', async () => {
  const expected = {
    'diagnostic-writer-validation': 'diagnostic-writer-validation-failure',
    'diagnostic-write-failure': 'launcher-failure',
    'unexpected-trap': 'runner-preflight-failure',
    'vite-startup': 'vite-startup-failure',
    'port-selection': 'port-selection-failure',
    'directory-creation': 'directory-creation-failure',
    'pid-read': 'pid-read-failure',
    'driver-startup': 'driver-startup-failure',
    'launcher-failure': 'launcher-failure',
    'bridge-health': 'bridge-health-failure',
    'app-exit': 'app-exit-failure',
    restart: 'restart-failure',
  };
  for (const [mode, classification] of Object.entries(expected)) {
    const artifact = await runShellFailure(mode);
    assert.equal(artifact.classification, classification, mode);
    assert.equal(artifact.renderer.locationClass, 'unavailable', mode);
    assert.equal(JSON.stringify(artifact).includes('client'), false, mode);
  }
});

test('shell boundary classifies no progress, native-dispatch stall, and every post-readiness failure phase', async () => {
  const expected = {
    'driver-no-progress': 'driver-startup-failure',
    'driver-bridge-stall': 'renderer-dispatch-timeout',
    'driver-renderer-stall': 'later-driver-failure',
    'driver-later-stall': 'later-driver-failure',
    'driver-fast-after-ready': 'later-driver-failure',
  };
  for (const [mode, classification] of Object.entries(expected)) {
    const artifact = await runShellFailure(mode);
    assert.equal(artifact.classification, classification, mode);
  }
});

test('derived startup guard gives snapshot and artifact bounds time before killing a no-progress hang', async () => {
  const startedAt = Date.now();
  const artifact = await runShellFailure('driver-artifact-hang', {
    timingOverrides: {
      GOLDEN_LOOP_HEALTH_BOUND_MS: '200',
      GOLDEN_LOOP_READINESS_BOUND_MS: '500',
      GOLDEN_LOOP_SNAPSHOT_BOUND_MS: '400',
      GOLDEN_LOOP_ARTIFACT_BOUND_MS: '400',
      GOLDEN_LOOP_DRIVER_CLEANUP_BOUND_MS: '200',
      GOLDEN_LOOP_DEADLINE_MARGIN_MS: '200',
    },
  });
  assert.equal(artifact.classification, 'driver-startup-failure');
  assert.ok(Date.now() - startedAt >= 900, 'outer guard killed the driver before its artifact allowance');
});

test('derived startup guard accepts the allowed slow readiness path and latches final progress before status', async () => {
  const startedAt = Date.now();
  const artifact = await runShellFailure('driver-slow-ready-failure', {
    timingOverrides: {
      GOLDEN_LOOP_HEALTH_BOUND_MS: '200',
      GOLDEN_LOOP_READINESS_BOUND_MS: '500',
      GOLDEN_LOOP_SNAPSHOT_BOUND_MS: '400',
      GOLDEN_LOOP_ARTIFACT_BOUND_MS: '400',
      GOLDEN_LOOP_DRIVER_CLEANUP_BOUND_MS: '200',
      GOLDEN_LOOP_DEADLINE_MARGIN_MS: '200',
    },
  });
  assert.equal(artifact.classification, 'later-driver-failure');
  assert.ok(Date.now() - startedAt >= 900, 'slow readiness fixture did not execute its allowed path');
});

test('shell controller executes both write and restart driver paths with sticky later-driver progress', async () => {
  assert.deepEqual(await runShellFailure('controller-success', { expectSuccess: true }), ['write', 'assert']);
});

test('the owned group leader survives TERM grace before escalation removes every descendant', async () => {
  const startedAt = Date.now();
  const artifact = await runShellFailure('driver-timeout');
  assert.equal(artifact.classification, 'driver-startup-failure');
  assert.ok(Date.now() - startedAt >= 3_000, 'cleanup escalated before the configured TERM grace elapsed');
  assert.ok(Date.now() - startedAt < 15_000, 'driver timeout exceeded its TERM plus KILL grace');
  const shellSource = await readFile(new URL('../golden-loop.sh', import.meta.url), 'utf8');
  assert.match(shellSource, /setsid bash -c[\s\S]*DRIVER_PGID=\$DRIVER_PID/, 'driver must have a tracked dedicated process group');
  assert.match(shellSource, /driver_group_is_owned[\s\S]*kill -TERM -- "-\$DRIVER_PGID"[\s\S]*driver_group_is_owned[\s\S]*kill -KILL -- "-\$DRIVER_PGID"/, 'each group signal must immediately follow an ownership check');
  assert.doesNotMatch(shellSource, /timeout[^\n]*\n\s*node "\$DRIVER"/, 'timeout must not own only the direct Node process');
});

test('real product-gate shell routes build and provenance failures to artifacts', async () => {
  for (const [mode, classification] of Object.entries({ build: 'product-gate-build-failure', provenance: 'product-gate-provenance-failure' })) {
    const root = testDirectory();
    const scripts = path.join(root, 'scripts');
    const bin = path.join(root, 'bin');
    const diagnostics = path.join(root, 'diagnostics');
    await mkdir(path.join(root, 'src-tauri'), { recursive: true });
    await mkdir(scripts);
    await mkdir(bin);
    for (const name of ['gate.sh', 'write-golden-loop-diagnostic.mjs', 'golden-loop-diagnostics.mjs']) {
      await writeFile(path.join(scripts, name), await readFile(new URL(`../${name}`, import.meta.url)));
    }
    await writeExecutable(path.join(bin, 'cargo'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_GATE_TEST_MODE" == build ]] && exit 1
mkdir -p target/debug
printf '#!/usr/bin/env bash\\nexit 0\\n' >target/debug/lantern
chmod 700 target/debug/lantern
`);
    await writeExecutable(path.join(scripts, 'golden-loop-launch-app.sh'), `#!/usr/bin/env bash
[[ "$GOLDEN_LOOP_GATE_TEST_MODE" == provenance ]] && exit 2
exit 0
`);
    await writeExecutable(path.join(scripts, 'golden-loop.sh'), '#!/usr/bin/env bash\nexit 0\n');
    try {
      let failure;
      try {
        await execFileAsync('bash', ['-c', 'source "$1"; run_golden_loop_gate', '_', path.join(scripts, 'gate.sh')], {
          cwd: root,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GOLDEN_LOOP_GATE_TEST_MODE: mode, GOLDEN_LOOP_DIAGNOSTIC_DIR: diagnostics },
        });
      } catch (error) { failure = error; }
      assert.ok(failure, `${mode} product-gate failure turned green`);
      const names = await (await import('node:fs/promises')).readdir(diagnostics);
      const artifact = JSON.parse(await readFile(path.join(diagnostics, names.at(-1)), 'utf8'));
      assert.equal(artifact.classification, classification);
      assert.match(failure.stderr, /sha256=[a-f0-9]{64}/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('early capture remains debug-only and diagnostics cannot change pass checks', async () => {
  const lib = await readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../golden-loop-driver.mjs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(debug_assertions\)\][\s\S]*golden_loop_diagnostics_initialization_script/);
  assert.match(driver, /await waitFor\('the explicitly opened workspace'/);
  assert.doesNotMatch(driver, /diagnostic pass/);
});
