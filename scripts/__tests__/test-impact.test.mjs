import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectImpact, staticImports } from '../test-impact.mjs';

test('finds the static imports used by a real Vitest file', () => {
  const { imports, opaque } = staticImports(fileURLToPath(new URL('../../src/ui/kp/RailShell.test.tsx', import.meta.url)));
  assert.equal(opaque, false);
  assert.ok(imports.includes('@/ui/kp'));
  assert.ok(imports.includes('vitest'));
});

test('selects the mandatory safety net and a smaller affected set for a real lane merge', () => {
  const parent = execFileSync('git', ['rev-parse', '19d016a6c^'], { encoding: 'utf8' }).trim();
  const result = selectImpact({ range: `${parent}..19d016a6c` });
  assert.equal(result.mode, 'affected');
  assert.ok(result.selectedCount < result.fullCount);
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
