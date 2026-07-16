import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDeclaredManifest, selectImpact, selectTestsForChanges, staticImports } from '../test-impact.mjs';

test('finds the static imports used by a real Vitest file', () => {
  const { imports, opaque } = staticImports(fileURLToPath(new URL('../../src/ui/kp/RailShell.test.tsx', import.meta.url)));
  assert.equal(opaque, false);
  assert.ok(imports.includes('@/ui/kp'));
  assert.ok(imports.includes('vitest'));
});

test('classifies an fs-extra source guard as filesystem-capable without inspecting its call site', () => {
  const parsed = staticImports(fileURLToPath(new URL('../../src/features/home/HomeSurfaceBoundaries.test.ts', import.meta.url)));
  assert.equal(parsed.filesystemCapability, true);
  assert.equal(parsed.opaque, true);
});

test('classifies a Node filesystem promises alias as filesystem-capable', () => {
  const fixture = fileURLToPath(new URL('./fixtures/NodeFilesystemNamespaceAdversarial.test.ts', import.meta.url));
  const parsed = staticImports(fixture);
  assert.equal(parsed.filesystemCapability, true);
  assert.equal(parsed.opaque, true);
});

test('classifies a direct Node filesystem import as filesystem-capable', () => {
  const fixture = fileURLToPath(new URL('./fixtures/NodeFilesystemDirectAdversarial.test.ts', import.meta.url));
  const parsed = staticImports(fixture);
  assert.equal(parsed.filesystemCapability, true);
  assert.equal(parsed.opaque, true);
});

test('does not mistake an application data read for a source dependency read', () => {
  const parsed = staticImports(fileURLToPath(new URL('../../src/App.tsx', import.meta.url)));
  assert.equal(parsed.opaque, false);
});

test('keeps a merge-commit range on the full suite', () => {
  const parent = execFileSync('git', ['rev-parse', '19d016a6c^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..19d016a6c` });
  assert.equal(result.mode, 'full');
  assert.equal(result.selectedCount, result.fullCount);
  assert.equal(result.fullCount, 1015);
  assert.match(result.reasons[0], /merge commit/i);
  assert.ok(result.testFiles.includes('tests/unit/architecture-boundaries.test.ts'));
  assert.ok(result.testFiles.includes('tests/unit/i18n/en-json-snapshot.test.ts'));
});

test('selects a narrow lane while always running capability-suspect and runtime-discovery coverage', () => {
  const parent = execFileSync('git', ['rev-parse', '37f29f741^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..37f29f741` });
  assert.equal(result.mode, 'affected');
  // 49 under the pre-manifest capability net (REVIEW-speedup-b-REDESIGN-VERDICT.md).
  // 47 here: the declared-dependency manifest narrows the two production
  // opaque tests (registry.source-read.test.ts, HomeSurfaceBoundaries.test.ts)
  // off this unrelated lane instead of always-running them. The escape-vector
  // closure below adds zero net-new opaque tests for this range -- every
  // escape-vector-suspect file in the repo already carries direct fs
  // capability too.
  assert.equal(result.selectedCount, 47);
  assert.ok(result.testFiles.includes('src/features/crm-clients/extensions/record-member-kebab/memberRail.test.tsx'));
  assert.ok(result.testFiles.includes('tests/unit/architecture-boundaries.test.ts'));
  assert.ok(result.testFiles.includes('tests/unit/website-content-lint.test.ts'));
  assert.ok(!result.testFiles.includes('src/platform/flags/registry.source-read.test.ts'));
  assert.ok(!result.testFiles.includes('src/features/home/HomeSurfaceBoundaries.test.ts'));
});

test('fails open to the full suite when it cannot read the requested diff', () => {
  const result = selectImpact({ range: 'does-not-exist..HEAD' });
  assert.equal(result.mode, 'full');
  assert.equal(result.selectedCount, result.fullCount);
  assert.match(result.reasons[0], /fail open/i);
});

test('always runs the formerly missed fs-extra boundary test for the evidence merge', () => {
  const parent = execFileSync('git', ['rev-parse', 'c601443f0^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..c601443f0` });
  assert.ok(result.testFiles.includes('src/features/home/HomeSurfaceBoundaries.test.ts'));
});

test('always runs an fs-extra source guard without needing a source-path edge', () => {
  const fixture = 'scripts/__tests__/fixtures/PathReadAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.equal(result.opaque, true);
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a direct Node filesystem source guard without needing a source-path edge', () => {
  const fixture = 'scripts/__tests__/fixtures/NodeFilesystemDirectAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a Node filesystem promises-alias source guard without needing a source-path edge', () => {
  const fixture = 'scripts/__tests__/fixtures/NodeFilesystemNamespaceAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a test that reaches a same-name filesystem re-export', () => {
  const fixture = 'scripts/__tests__/fixtures/NodeFilesystemSameNameReexportAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a test that reaches filesystem access through an aliased local re-export', () => {
  const fixture = 'scripts/__tests__/fixtures/NodeFilesystemReexportAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

// --- Permanent escape-vector regressions -----------------------------------
// REVIEW-speedup-b-REDESIGN-VERDICT.md reproduced a full miss: a test that
// reads production source through node:child_process (no fs import, no import
// edge) was classified skippable and a genuine regression it would have
// caught was omitted from an affected-only run. worker_threads, createRequire
// bound to a non-`require` name, and process.getBuiltinModule were named as
// further standard-Node escapes of the same shape. Each is a permanent
// regression here: undeclared + capability-suspect must classify opaque.

test('always runs a child_process source guard without needing a source-path edge (the reproduced escape)', () => {
  const fixture = 'scripts/__tests__/fixtures/ChildProcessSourceReadAdversarial.test.ts';
  const parsed = staticImports(fileURLToPath(new URL(`../../${fixture}`, import.meta.url)));
  assert.equal(parsed.filesystemCapability, false);
  assert.equal(parsed.escapeVectorCapability, true);
  assert.equal(parsed.opaque, true);
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.escapeVectorCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.opaqueTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a process.getBuiltinModule source guard without needing a source-path edge', () => {
  const fixture = 'scripts/__tests__/fixtures/GetBuiltinModuleSourceReadAdversarial.test.ts';
  const parsed = staticImports(fileURLToPath(new URL(`../../${fixture}`, import.meta.url)));
  assert.equal(parsed.filesystemCapability, false);
  assert.equal(parsed.escapeVectorCapability, true);
  assert.equal(parsed.opaque, true);
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.escapeVectorCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.opaqueTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('classifies a require bound to a non-require name via createRequire as filesystem-capable', () => {
  // Structural fix, not a blanket node:module flag: createRequire(...)('node:fs')
  // is tracked back to the fs specifier itself, so this shows up as ordinary
  // filesystem capability, exactly like a literal `require('node:fs')` would.
  const fixture = 'scripts/__tests__/fixtures/CreateRequireSourceReadAdversarial.test.ts';
  const parsed = staticImports(fileURLToPath(new URL(`../../${fixture}`, import.meta.url)));
  assert.equal(parsed.filesystemCapability, true);
  assert.equal(parsed.opaque, true);
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

test('always runs a test whose worker thread reads source, via the resolved worker-script edge', () => {
  // Structural fix, not a blanket node:worker_threads flag: new Worker(url)'s
  // literal script path is resolved as a real graph edge into
  // WorkerThreadsSourceReadWorker.ts, whose own node:fs import is what makes
  // this opaque -- transitively, the same mechanism as the existing local
  // re-export fixtures use.
  const fixture = 'scripts/__tests__/fixtures/WorkerThreadsSourceReadAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.deepEqual(result.filesystemCapabilityTestFiles, [fixture]);
  assert.deepEqual(result.testFiles, [fixture]);
});

// --- Declared-dependency manifest (the lever-b fallback) --------------------

test('a declared-dependency manifest entry narrows a capability-suspect test to its named dependency instead of always-run', () => {
  const fixture = 'src/platform/flags/registry.source-read.test.ts';
  const unrelated = selectTestsForChanges({ testFiles: [fixture], changedFiles: ['src/app/App.tsx'] });
  assert.deepEqual(unrelated.opaqueTestFiles, []);
  assert.deepEqual(unrelated.testFiles, []);
  const related = selectTestsForChanges({ testFiles: [fixture], changedFiles: ['src/platform/flags/registry.ts'] });
  assert.deepEqual(related.testFiles, [fixture]);
});

test('applyDeclaredManifest throws on a stale entry for a test that is no longer capability-suspect', () => {
  assert.throws(
    () => applyDeclaredManifest(new Set(), { entries: { 'some/test.ts': { reason: 'x', dependencies: [] } } }, ['some/test.ts'], new Map()),
    /stale/i,
  );
});

test('applyDeclaredManifest throws when a declared dependency file does not exist', () => {
  assert.throws(
    () => applyDeclaredManifest(
      new Set(['some/test.ts']),
      { entries: { 'some/test.ts': { reason: 'x', dependencies: ['does/not/exist.ts'] } } },
      ['some/test.ts'],
      new Map(),
    ),
    /does not exist/,
  );
});

test('applyDeclaredManifest throws when an entry has no reason', () => {
  assert.throws(
    () => applyDeclaredManifest(new Set(['some/test.ts']), { entries: { 'some/test.ts': { dependencies: [] } } }, ['some/test.ts'], new Map()),
    /reason/i,
  );
});

test('selectImpact fails open when a manifest entry names a file that is not a tracked test (typo/stale)', () => {
  // Unlike applyDeclaredManifest's general "skip an entry outside this call's
  // subset" behavior (tested above, and needed so the narrow fixture-only
  // calls throughout this file don't trip over the real manifest's unrelated
  // entries), selectImpact always passes the complete, real test universe --
  // so an unknown entry there is unambiguously a typo or a stale reference,
  // never legitimately out of scope, and must throw loudly rather than be
  // silently ignored.
  const manifestPath = fileURLToPath(new URL('../test-impact-manifest.json', import.meta.url));
  const original = readFileSync(manifestPath, 'utf8');
  try {
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      description: 'typo probe',
      entries: { 'src/App.tsx': { reason: 'not a real tracked test file', dependencies: [] } },
    }));
    const parent = execFileSync('git', ['rev-parse', '37f29f741^'], { encoding: 'utf8' }).trim();
    const result = selectImpact({ range: `${parent}..37f29f741` });
    assert.equal(result.mode, 'full');
    assert.match(result.reasons[0], /not a currently tracked test/);
  } finally {
    writeFileSync(manifestPath, original);
  }
});

test('applyDeclaredManifest ignores an entry for a test outside the requested set', () => {
  const result = applyDeclaredManifest(
    new Set(),
    { entries: { 'outside/of/scope.test.ts': { reason: 'x', dependencies: [] } } },
    ['some/test.ts'],
    new Map(),
  );
  assert.equal(result.opaqueTests.size, 0);
});

test('the real declared-dependency manifest is well-formed and every entry is currently capability-suspect', () => {
  // Exercised implicitly by every real selectImpact call above (a malformed
  // or stale entry throws inside the selector's try and fails the whole
  // selection open to full, silently); this test names the property
  // directly against the live suite so a stale entry fails loudly here.
  const manifestPath = fileURLToPath(new URL('../test-impact-manifest.json', import.meta.url));
  const declaredManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.ok(declaredManifest.entries && typeof declaredManifest.entries === 'object');
  const testFiles = Object.keys(declaredManifest.entries);
  assert.ok(testFiles.length > 0);
  for (const testFile of testFiles) {
    const entry = declaredManifest.entries[testFile];
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length > 0, testFile);
    assert.ok(Array.isArray(entry.dependencies), testFile);
  }
  const result = selectTestsForChanges({ testFiles, changedFiles: [] });
  // Every declared entry must be capability-suspect right now (fs or an
  // escape vector) -- applyDeclaredManifest would throw "stale" otherwise,
  // and this call would have already thrown before reaching here.
  assert.deepEqual(result.opaqueTestFiles, []);
});

function runWrapperWithSelectorFailure(injection) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'test-impact-wrapper-'));
  const marker = path.join(directory, 'vitest-command.json');
  const npx = path.join(directory, 'npx');
  writeFileSync(npx, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.TEST_IMPACT_VITEST_MARKER, JSON.stringify(process.argv.slice(2)));\n`);
  chmodSync(npx, 0o755);
  try {
    const runner = fileURLToPath(new URL('../test-impact-run.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [runner, '--range', 'HEAD~1..HEAD'], {
      cwd: path.resolve(import.meta.dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        TEST_IMPACT_TEST_INJECT: injection,
        TEST_IMPACT_SELECTOR_TIMEOUT_MS: '20',
        TEST_IMPACT_VITEST_MARKER: marker,
      },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['vitest', 'run']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const injection of ['early-selector-error', 'mid-selector-error', 'empty-selector-output', 'selector-timeout']) {
  test(`wrapper runs the full suite when selection has ${injection}`, () => {
    runWrapperWithSelectorFailure(injection);
  });
}
