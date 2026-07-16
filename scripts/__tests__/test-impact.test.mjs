import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectImpact, selectTestsForChanges, staticImports } from '../test-impact.mjs';

test('finds the static imports used by a real Vitest file', () => {
  const { imports, opaque } = staticImports(fileURLToPath(new URL('../../src/ui/kp/RailShell.test.tsx', import.meta.url)));
  assert.equal(opaque, false);
  assert.ok(imports.includes('@/ui/kp'));
  assert.ok(imports.includes('vitest'));
});

test('models a source file read through a path assembled at runtime', () => {
  const descriptor = fileURLToPath(new URL('../../src/app/shell/registry/legacyAppSurfaceDescriptors.tsx', import.meta.url));
  const parsed = staticImports(fileURLToPath(new URL('../../src/features/home/HomeSurfaceBoundaries.test.ts', import.meta.url)));
  assert.equal(parsed.opaque, false);
  assert.ok(parsed.fileDependencies.includes(descriptor));
});

test('fails open for a real lane merge when the repository has runtime-discovered dependencies', () => {
  const parent = execFileSync('git', ['rev-parse', '19d016a6c^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..19d016a6c` });
  assert.equal(result.mode, 'full');
  assert.equal(result.selectedCount, result.fullCount);
  assert.equal(result.fullCount, 1014);
  assert.ok(result.testFiles.includes('tests/unit/architecture-boundaries.test.ts'));
  assert.ok(result.testFiles.includes('tests/unit/i18n/en-json-snapshot.test.ts'));
});

test('fails open to the full suite when it cannot read the requested diff', () => {
  const result = selectImpact({ range: 'does-not-exist..HEAD' });
  assert.equal(result.mode, 'full');
  assert.equal(result.selectedCount, result.fullCount);
  assert.match(result.reasons[0], /fail open/i);
});

test('selects the formerly missed boundary test for the evidence merge', () => {
  const parent = execFileSync('git', ['rev-parse', 'c601443f0^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..c601443f0` });
  assert.ok(result.testFiles.includes('src/features/home/HomeSurfaceBoundaries.test.ts'));
});

test('selects an adversarial path-read dependency without an import edge', () => {
  const fixture = 'scripts/__tests__/fixtures/PathReadAdversarial.test.ts';
  const result = selectTestsForChanges({
    testFiles: [fixture],
    changedFiles: ['src/platform/flags/registry.ts'],
  });
  assert.equal(result.opaque, false);
  assert.deepEqual(result.testFiles, [fixture]);
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
