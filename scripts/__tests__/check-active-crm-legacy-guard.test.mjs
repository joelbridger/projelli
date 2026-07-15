import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findActiveCrmLegacyGuardViolations } from '../check-active-crm-legacy-guard.mjs';

const temporaryRoots = [];
const config = {
  sourceRoot: 'src',
  activeClientRoots: ['features/crm-clients'],
  legacyFeaturePrefix: '@/features/matters/',
  compatibilityAdapterImports: [
    ['src/features/crm-clients/ClientMapWorkspace.tsx', '@/features/matters/clientMap/openSource'],
  ],
  activeMount: {
    file: 'src/app/shell/AppSurfaceRouter.tsx',
    module: '@/features/crm-clients',
    symbol: 'ClientsSurface',
  },
  legacyMountModules: ['@/features/matters/MattersHome', '@/features/matters/MatterHub'],
};

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'active-crm-legacy-guard-'));
  temporaryRoots.push(root);
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  return root;
}

function liveMount() {
  return "import { ClientsSurface } from '@/features/crm-clients'; export const Router = () => <ClientsSurface />;";
}

afterEach(() => temporaryRoots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('active CRM/client legacy guard', () => {
  it('rejects a new active-client import of MattersHome', () => {
    const root = fixture({
      'src/app/shell/AppSurfaceRouter.tsx': liveMount(),
      'src/features/crm-clients/extensions/new-capability.ts': "import { MattersHome } from '@/features/matters/MattersHome'; export { MattersHome };",
    });
    assert.deepEqual(findActiveCrmLegacyGuardViolations({ repoRoot: root, config }).map(({ file, specifier }) => ({ file, specifier })), [
      { file: 'src/features/crm-clients/extensions/new-capability.ts', specifier: '@/features/matters/MattersHome' },
    ]);
  });

  it('rejects replacing the named ClientsSurface mount with MatterHub', () => {
    const root = fixture({
      'src/app/shell/AppSurfaceRouter.tsx': "import { MatterHub } from '@/features/matters/MatterHub'; export const Router = () => <MatterHub />;",
      'src/features/crm-clients/index.ts': 'export const active = true;',
    });
    const violations = findActiveCrmLegacyGuardViolations({ repoRoot: root, config });
    assert.equal(violations.length, 2);
    assert.deepEqual(violations.map(({ specifier }) => specifier), [
      '@/features/crm-clients',
      '@/features/matters/MatterHub',
    ]);
  });

  it('allows the documented Client Map compatibility adapter and the named live mount', () => {
    const root = fixture({
      'src/app/shell/AppSurfaceRouter.tsx': liveMount(),
      'src/features/crm-clients/ClientMapWorkspace.tsx': "import { openSource } from '@/features/matters/clientMap/openSource'; export { openSource };",
    });
    assert.deepEqual(findActiveCrmLegacyGuardViolations({ repoRoot: root, config }), []);
  });
});
