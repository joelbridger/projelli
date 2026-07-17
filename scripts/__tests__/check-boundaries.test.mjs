import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBoundaryBaseline, findBoundaryViolations } from '../check-boundaries.mjs';

const temporaryRoots = [];
const config = {
  sourceRoot: 'src',
  publicEntrypoints: ['index.ts', 'index.tsx'],
  baselineFile: '.baseline.json',
};

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'feature-boundaries-'));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  return root;
}

afterEach(() => temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('feature-boundary checker', () => {
  it('catches a feature reaching into another feature internals', () => {
    const root = fixture({
      'src/features/alpha/Screen.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'src/features/beta/index.ts': 'export const publicApi = true;',
      'src/features/beta/private.ts': 'export const secret = true;',
    });
    assert.deepEqual(findBoundaryViolations({ repoRoot: root, config }).map(({ file, specifier }) => ({ file, specifier })), [
      { file: 'src/features/alpha/Screen.ts', specifier: '@/features/beta/private' },
    ]);
  });

  it('catches private feature imports from the app shell, fixtures, and sibling features', () => {
    const root = fixture({
      'src/app/AppShell.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'src/app/fixtures/AppShellFixture.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'tests/fixtures/PrivateFeatureFixture.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'foundation-contracts/privateFeatureContract.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'src/features/alpha/Screen.ts': "import { secret } from '@/features/beta/private'; export { secret };",
      'src/features/beta/index.ts': 'export const publicApi = true;',
      'src/features/beta/private.ts': 'export const secret = true;',
    });

    assert.deepEqual(findBoundaryViolations({ repoRoot: root, config }).map(({ file, specifier }) => ({ file, specifier })), [
      { file: 'foundation-contracts/privateFeatureContract.ts', specifier: '@/features/beta/private' },
      { file: 'src/app/AppShell.ts', specifier: '@/features/beta/private' },
      { file: 'src/app/fixtures/AppShellFixture.ts', specifier: '@/features/beta/private' },
      { file: 'src/features/alpha/Screen.ts', specifier: '@/features/beta/private' },
      { file: 'tests/fixtures/PrivateFeatureFixture.ts', specifier: '@/features/beta/private' },
    ]);
  });

  it('allows a public index import and ratchets a known violation', () => {
    const root = fixture({
      'src/features/alpha/Screen.ts': "import { publicApi } from '@/features/beta'; export { publicApi };",
      'src/features/beta/index.ts': 'export const publicApi = true;',
    });
    assert.deepEqual(findBoundaryViolations({ repoRoot: root, config }), []);
    assert.deepEqual(checkBoundaryBaseline({ root, config, update: true }), { ok: true, updated: true, count: 0 });
    assert.deepEqual(checkBoundaryBaseline({ root, config }), { ok: true, count: 0, regressions: [] });
  });

  it('catches a backtick dynamic import that reaches into another feature', () => {
    const root = fixture({
      'src/features/alpha/Screen.ts': "const load = () => import(`@/features/beta/private`); export { load };",
      'src/features/beta/index.ts': 'export const publicApi = true;',
      'src/features/beta/private.ts': 'export const secret = true;',
    });
    assert.deepEqual(findBoundaryViolations({ repoRoot: root, config }).map(({ file, specifier }) => ({ file, specifier })), [
      { file: 'src/features/alpha/Screen.ts', specifier: '@/features/beta/private' },
    ]);
  });

  it('treats CRM folders as one composite feature and allows an extensionless public index', () => {
    const root = fixture({
      'src/features/crm-home/Screen.ts': "import { registry } from '@/features/crm-views/registry'; export { registry };",
      'src/features/crm-views/registry.ts': 'export const registry = true;',
      'src/features/alpha/Screen.ts': "import { publicApi } from '@/features/beta/index'; export { publicApi };",
      'src/features/beta/index.ts': 'export const publicApi = true;',
    });
    assert.deepEqual(findBoundaryViolations({ repoRoot: root, config }), []);
  });
});
