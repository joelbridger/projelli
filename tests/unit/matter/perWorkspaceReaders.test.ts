/**
 * QA-93 stages C + D — readers and whole-practice Ask see the CURRENT workspace
 * only.
 *
 * Because the matter store's in-memory slice now holds only the active
 * workspace's matters, every non-reactive reader that funnels through it —
 * `getMatters`, `getActiveScope`, `resolveMatterIdForPath` — and the
 * whole-practice book digest (`buildBookFactsDigest(getMatters(), maps)`)
 * automatically scope to the current workspace. These tests lock that in so a
 * future change that reintroduces a global read is caught.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useMatterStore, getMatters, resolveMatterIdForPath } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildBookFactsDigest } from '@/features/ask/book/bookFacts';
import { setActiveWorkspaceScopeRoot } from '@/platform/state/workspaceScope';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';

/** A minimal built client map with one real (non-assumption) fact. */
function builtMap(matterId: string, text: string): unknown {
  return {
    matterId,
    lastBuiltAt: '2026-01-02T00:00:00Z',
    sections: [
      { id: 'money', key: 'money', title: 'Money', kind: 'core', items: [{ id: 'i1', text, sources: [] }] },
    ],
    completeness: { know: 1, assuming: 0, level: 'thin', ask: [] },
  };
}

const baseMatter = {
  name: 'C', client: 'C', mailFolderPaths: [], crmHouseholdKeys: [], onedriveFolderKeys: [],
  boxFolderKeys: [], esignKeys: [], jotformKeys: [], sharefileFolderKeys: [], meetingKeys: [],
  zocksKeys: [], addeparKeys: [], privileged: false, mcpAccessGranted: false, shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

async function reloadForWorkspace(root: string | null): Promise<void> {
  setActiveWorkspaceScopeRoot(root);
  await useMatterStore.persist.rehydrate();
  await useClientMapStore.persist.rehydrate();
}

beforeEach(() => {
  localStorage.clear();
  useMatterStore.setState({ matters: [], activeMatterId: null, snapshots: {}, cache: {}, statusByMatterId: {} });
  useClientMapStore.setState({ maps: {}, clientQuestions: {} });
  setActiveWorkspaceScopeRoot(null);
  // Legacy global data with a client in each of two workspaces.
  localStorage.setItem('lantern:matters', JSON.stringify({
    state: {
      matters: [
        { ...baseMatter, id: 'a1', name: 'Acme', client: 'Acme', folderPaths: ['/wsA/Acme'] },
        { ...baseMatter, id: 'b1', name: 'Gamma', client: 'Gamma', folderPaths: ['/wsB/Gamma'] },
      ],
      activeMatterId: null,
    },
    version: 10,
  }));
  localStorage.setItem('lantern:client-maps', JSON.stringify({
    state: {
      maps: { a1: builtMap('a1', 'Acme retires 2030'), b1: builtMap('b1', 'Gamma sells business') },
      clientQuestions: {},
    },
    version: 3,
  }));
});
afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
});

describe('QA-93 stage C — readers scope to the current workspace', () => {
  it('getMatters returns only the current workspace matters', async () => {
    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    await reloadForWorkspace('/wsB');
    expect(getMatters().map((m) => m.id)).toEqual(['b1']);
  });

  it('resolveMatterIdForPath does NOT resolve a file that belongs to another workspace', async () => {
    await reloadForWorkspace('/wsA');
    // A file under A's client resolves to a1.
    expect(resolveMatterIdForPath('/wsA/Acme/plan.docx')).toBe('a1');
    // A file under B's client (whose matter is NOT loaded in this workspace) does
    // not resolve to anything — no cross-workspace leak.
    expect(resolveMatterIdForPath('/wsB/Gamma/plan.docx')).toBe(UNASSIGNED_MATTER_ID);
  });
});

describe('QA-93 stage D — whole-practice Ask counts the current workspace only', () => {
  it('the book digest built from getMatters() names only the current workspace clients', async () => {
    await reloadForWorkspace('/wsA');
    const digestA = buildBookFactsDigest(getMatters(), useClientMapStore.getState().maps);
    expect(digestA.clients.map((c) => c.matterId)).toEqual(['a1']);

    await reloadForWorkspace('/wsB');
    const digestB = buildBookFactsDigest(getMatters(), useClientMapStore.getState().maps);
    expect(digestB.clients.map((c) => c.matterId)).toEqual(['b1']);
  });
});
