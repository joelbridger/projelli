import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyDiagnostic, safeArtifact, writeDiagnosticArtifact } from '../golden-loop-diagnostics.mjs';

test('classifies representative module, console/rejection, and network failures', () => {
  assert.equal(classifyDiagnostic({ resourceFailures: ['script /src/main.tsx'] }), 'network-or-module-request-failure');
  assert.equal(classifyDiagnostic({ pageErrors: ['Failed to resolve module specifier'] }), 'javascript-module-import-error');
  assert.equal(classifyDiagnostic({ unhandledRejections: ['boom'] }), 'unhandled-rejection');
  assert.equal(classifyDiagnostic({ consoleErrors: ['render failed'] }), 'console-error');
  assert.equal(classifyDiagnostic({ rootPresent: true, rootHasChildren: false }), 'react-mount-did-not-run');
  assert.equal(classifyDiagnostic({}), 'native-webview-vite-xvfb-blank-renderer');
});

test('artifact is bounded and excludes workspace contents and arbitrary storage', async () => {
  const directory = path.join(os.tmpdir(), `golden-loop-diagnostic-test-${process.pid}`);
  try {
    const result = await writeDiagnosticArtifact({
      phase: 'write', failure: 'x'.repeat(5_000),
      renderer: { url: 'http://localhost:5174/', explicitWorkspace: '/private/client-data', dom: 'd'.repeat(8_000) },
      events: { consoleErrors: Array.from({ length: 30 }, () => 'e'.repeat(2_000)) },
    }, directory);
    const saved = JSON.parse(await readFile(result.path, 'utf8'));
    assert.equal(saved.renderer.explicitWorkspaceConfigured, true);
    assert.equal(saved.renderer.dom.length, 4_000);
    assert.equal(saved.events.consoleErrors.length, 20);
    assert.equal(saved.events.consoleErrors[0].length, 1_000);
    assert.equal(JSON.stringify(saved).includes('/private/client-data'), false);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('early capture remains debug-only and diagnostics cannot change pass checks', async () => {
  const lib = await readFile(new URL('../../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const driver = await readFile(new URL('../golden-loop-driver.mjs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(debug_assertions\)\][\s\S]*golden_loop_diagnostics_initialization_script/);
  assert.match(driver, /await waitFor\('the explicitly opened workspace'/);
  assert.match(driver, /writeDiagnosticArtifact/);
  assert.doesNotMatch(driver, /return true;\s*\/\/ diagnostic pass/);
  assert.equal(safeArtifact({ events: { consoleErrors: ['diagnostic only'] } }).classification, 'console-error');
});
