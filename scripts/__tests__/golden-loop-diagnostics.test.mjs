import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { classifyDiagnostic, safeArtifact, writeDiagnosticArtifact } from '../golden-loop-diagnostics.mjs';

const testDirectory = () => path.join(os.tmpdir(), `golden-loop-diagnostic-test-${process.pid}-${Date.now()}`);

async function installedRecorder() {
  const source = await readFile(new URL('../../src-tauri/src/dev_bridge.rs', import.meta.url), 'utf8');
  const script = source.match(/Some\(r#"([\s\S]*?)"#\.to_string\(\)\)/)?.[1];
  assert.ok(script, 'could not extract the installed initialization script');
  const listeners = new Map();
  const window = {
    location: { href: 'http://localhost:5174/?token=secret#fragment' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    console: undefined,
  };
  const console = { error() {} };
  window.fetch = async () => ({ status: 200 });
  vm.runInNewContext(script, { window, console, URL });
  return { window, listeners, console };
}

test('installed early recorder retains only categories, safe locations, and HTTP status', async () => {
  const { window, listeners, console } = await installedRecorder();
  const secret = 'Bearer very-secret-client-content';
  listeners.get('error')({ target: window, message: `Failed to import ${secret}`, filename: 'http://localhost:5174/src/main.tsx?token=bad#x' });
  listeners.get('error')({ target: window, message: secret, error: { name: 'TypeError' }, filename: 'https://example.test/client/123?token=bad' });
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
    const result = await writeDiagnosticArtifact({
      phase: 'write',
      renderer: { url: window.location.href, rootPresent: true, rootHasChildren: false, dom: { elementCount: 12, tags: ['div', 'script', 'client-secret'] } },
      events: {
        ...window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__,
        networkFailures: [...rejected.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures, ...http500.window.__LANTERN_GOLDEN_LOOP_DIAGNOSTICS__.networkFailures],
      },
    }, directory);
    const encoded = await readFile(result.path, 'utf8');
    const saved = JSON.parse(encoded);
    assert.equal(saved.renderer.url, 'http://localhost:5174/');
    assert.equal(saved.classification, 'javascript-module-import-error');
    assert.deepEqual(saved.events.networkFailures.map(({ category, status }) => ({ category, status })), [
      { category: 'fetch-rejected', status: undefined },
      { category: 'http-response-failure', status: 404 },
      { category: 'http-response-failure', status: 500 },
    ]);
    assert.equal(saved.renderer.dom.tags.includes('other'), true);
    assert.equal(encoded.includes(secret), false);
    assert.equal(encoded.includes('?token='), false);
    assert.equal(encoded.includes('#fragment'), false);
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
      'vite-startup': 'vite-startup-failure', launcher: 'launcher-failure', 'bridge-health': 'bridge-health-failure',
      'app-exit': 'app-exit-failure', restart: 'restart-failure',
    })) {
      const result = await writeDiagnosticArtifact({ phase }, directory);
      const encoded = await readFile(result.path, 'utf8');
      assert.equal(result.artifact.classification, classification);
      assert.equal(result.artifact.renderer.url, 'unavailable');
      assert.equal(encoded.includes('workspace'), false);
      assert.equal(result.sha256, createHash('sha256').update(encoded).digest('hex'));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('early capture remains debug-only and diagnostics cannot change pass checks', async () => {
  const lib = await readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../golden-loop-driver.mjs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(debug_assertions\)\][\s\S]*golden_loop_diagnostics_initialization_script/);
  assert.match(driver, /await waitFor\('the explicitly opened workspace'/);
  assert.doesNotMatch(driver, /diagnostic pass/);
});
