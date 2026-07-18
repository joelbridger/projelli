/**
 * F2.5 — `list_files` fail-closed pre-check (assertDirInActiveMatter).
 *
 * Locks the eval finding fix: reject `..` traversal and cross-matter directories
 * BEFORE the filesystem is touched, while still permitting ancestor navigation
 * (list "/ws" to reach a nested matter) and all-clients listing.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { assertDirInActiveMatter } from '@/features/ask/hooks/fileAccessGuards';
import type { Matter } from '@/platform/types/matter';

const selectionState = vi.hoisted(() => ({ refuse: false }));
vi.mock('@/platform/client-context', () => ({
  readSelectionOperationDecision: () =>
    selectionState.refuse
      ? { kind: 'refused', reason: 'follower-disagreement', message: 'Selection is catching up.' }
      : { kind: 'matter', sourceKind: 'matter-only', matter: {}, client: null },
}));

beforeEach(() => {
  selectionState.refuse = false;
});

const ROOT = '/ws';
const acme: Matter = {
  id: 'm-acme',
  name: 'Acme',
  client: 'Acme Corp',
  folderPaths: ['/ws/Clients/Acme'],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const beta: Matter = {
  id: 'm-beta',
  name: 'Beta',
  client: 'Beta LLC',
  folderPaths: ['/ws/Clients/Beta'],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const matters = [acme, beta];

const acmeScope = { toolActiveMatterId: 'm-acme', toolMatters: matters, activeMatterName: 'Acme' };
const allScope = { toolActiveMatterId: null, toolMatters: matters, activeMatterName: null };

describe('assertDirInActiveMatter — traversal', () => {
  it('rejects a ".." segment in ANY scope, before FS', () => {
    expect(() => assertDirInActiveMatter('/ws/../secret', '../secret', acmeScope, acme.folderPaths)).toThrow(/must not contain/);
    expect(() => assertDirInActiveMatter('/ws/../secret', '../secret', allScope, [])).toThrow(/must not contain/);
  });
});

describe('assertDirInActiveMatter — matter scope', () => {
  it('allows the matter folder itself', () => {
    expect(() => assertDirInActiveMatter('/ws/Clients/Acme', 'Clients/Acme', acmeScope, acme.folderPaths)).not.toThrow();
  });
  it('allows a subfolder of the matter', () => {
    expect(() => assertDirInActiveMatter('/ws/Clients/Acme/Litigation', 'Clients/Acme/Litigation', acmeScope, acme.folderPaths)).not.toThrow();
  });
  it('allows an ANCESTOR of the matter folder (navigate down)', () => {
    // Listing the root, and the intermediate "Clients" dir, must be allowed so
    // the model can walk down toward the matter.
    expect(() => assertDirInActiveMatter(ROOT, '.', acmeScope, acme.folderPaths)).not.toThrow();
    expect(() => assertDirInActiveMatter('/ws/Clients', 'Clients', acmeScope, acme.folderPaths)).not.toThrow();
  });
  it('REJECTS a sibling / other-matter directory', () => {
    expect(() => assertDirInActiveMatter('/ws/Clients/Beta', 'Clients/Beta', acmeScope, acme.folderPaths)).toThrow(/outside the active/);
  });
  it('rejects an unrelated directory outside the matter tree', () => {
    expect(() => assertDirInActiveMatter('/ws/Firm', 'Firm', acmeScope, acme.folderPaths)).toThrow(/outside the active/);
  });
  it('refuses and surfaces forced follower disagreement before filesystem access', () => {
    selectionState.refuse = true;
    expect(() =>
      assertDirInActiveMatter('/ws/Clients/Acme', 'Clients/Acme', acmeScope, acme.folderPaths),
    ).toThrow('Selection is catching up.');
  });
});

describe('assertDirInActiveMatter — Windows mixed separators (Codex P2)', () => {
  // Matter.folderPaths are forward-slash normalized; a native Windows workspace
  // root can carry backslashes, so dirPath arrives mixed. Ancestor navigation
  // must still work via the cross-platform containment predicate.
  const winAcme: Matter = {
    id: 'm-acme',
    name: 'Acme',
    client: 'Acme Corp',
    folderPaths: ['C:/WS/Clients/Acme'],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const winScope = { toolActiveMatterId: 'm-acme', toolMatters: [winAcme], activeMatterName: 'Acme' };
  it('allows listing the backslash root as an ancestor of a forward-slash folder', () => {
    expect(() => assertDirInActiveMatter('C:\\WS', '.', winScope, winAcme.folderPaths)).not.toThrow();
    expect(() => assertDirInActiveMatter('C:\\WS/Clients', 'Clients', winScope, winAcme.folderPaths)).not.toThrow();
  });
  it('still allows the matter folder itself with mixed separators', () => {
    expect(() => assertDirInActiveMatter('C:\\WS\\Clients\\Acme', 'Clients/Acme', winScope, winAcme.folderPaths)).not.toThrow();
  });
});

describe('assertDirInActiveMatter — all clients', () => {
  it('allows any in-workspace directory when no matter is active', () => {
    expect(() => assertDirInActiveMatter(ROOT, '.', allScope, [])).not.toThrow();
    expect(() => assertDirInActiveMatter('/ws/Clients/Beta', 'Clients/Beta', allScope, [])).not.toThrow();
  });
});
