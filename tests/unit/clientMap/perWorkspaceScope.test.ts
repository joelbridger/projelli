/**
 * QA-93 — client-map state is PER WORKSPACE.
 *
 * Client maps (and their "questions for the client") used to persist under an
 * APP-GLOBAL localStorage key, so a client's private map from workspace A stayed
 * loaded in workspace B. These tests pin the per-workspace scoping + one-time
 * migration: maps are carried into a workspace only for matter ids that belong to
 * it (the matter store is reloaded first, so `getMatters()` reflects the current
 * workspace), and the legacy global data is left intact.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useMatterStore, getMatters } from '@/platform/matter/matterStore';
import {
  setActiveWorkspaceScopeRoot,
  workspaceScopeId,
} from '@/platform/state/workspaceScope';
import { SK_CLIENT_MAPS } from '@/config/identity';
import type { ClientMap } from '@/platform/clientMap/types';

function scopedClientMapsKey(root: string): string {
  return `${SK_CLIENT_MAPS}::ws:${workspaceScopeId(root)}`;
}
function seed(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
function mapIdsInKey(key: string): string[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  const env = JSON.parse(raw) as { state?: { maps?: Record<string, unknown> } };
  return Object.keys(env.state?.maps ?? {}).sort();
}

function fakeMap(matterId: string): ClientMap {
  return {
    matterId,
    sections: [],
    completeness: { know: 0, assuming: 0, level: 'thin', ask: [] },
  } as unknown as ClientMap;
}

const baseMatter = {
  name: 'C',
  client: 'C',
  mailFolderPaths: [],
  crmHouseholdKeys: [],
  onedriveFolderKeys: [],
  boxFolderKeys: [],
  esignKeys: [],
  jotformKeys: [],
  sharefileFolderKeys: [],
  meetingKeys: [],
  zocksKeys: [],
  addeparKeys: [],
  privileged: false,
  mcpAccessGranted: false,
  shared: false,
  createdAt: '2026-01-01T00:00:00Z',
};

/** Reload BOTH stores as the reload orchestrator does: matters first (so
 *  getMatters() reflects the workspace), then client maps. */
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
});
afterEach(() => {
  setActiveWorkspaceScopeRoot(null);
});

describe('QA-93 — client maps are per workspace', () => {
  it('carries a map into a workspace only when its matter belongs to that workspace', async () => {
    // Two matters live in different workspaces; each has a client map.
    seed(SK_CLIENT_MAPS, {
      state: { maps: { a1: fakeMap('a1'), b1: fakeMap('b1') }, clientQuestions: { a1: [], b1: [] } },
      version: 3,
    });
    seed('lantern:matters', {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Gamma'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    });

    await reloadForWorkspace('/wsA');
    expect(getMatters().map((m) => m.id)).toEqual(['a1']);
    expect(Object.keys(useClientMapStore.getState().maps)).toEqual(['a1']);
    // scoped key holds only a1; global intact with both.
    expect(mapIdsInKey(scopedClientMapsKey('/wsA'))).toEqual(['a1']);
    expect(mapIdsInKey(SK_CLIENT_MAPS)).toEqual(['a1', 'b1']);
  });

  it('switching workspaces swaps the visible maps (no bleed)', async () => {
    seed(SK_CLIENT_MAPS, {
      state: { maps: { a1: fakeMap('a1'), b1: fakeMap('b1') }, clientQuestions: {} },
      version: 3,
    });
    seed('lantern:matters', {
      state: {
        matters: [
          { ...baseMatter, id: 'a1', folderPaths: ['/wsA/Acme'] },
          { ...baseMatter, id: 'b1', folderPaths: ['/wsB/Gamma'] },
        ],
        activeMatterId: null,
      },
      version: 10,
    });

    await reloadForWorkspace('/wsA');
    expect(Object.keys(useClientMapStore.getState().maps)).toEqual(['a1']);
    await reloadForWorkspace('/wsB');
    expect(Object.keys(useClientMapStore.getState().maps)).toEqual(['b1']);
  });

  it('a fresh workspace shows no client maps', async () => {
    await reloadForWorkspace('/wsFresh');
    expect(useClientMapStore.getState().maps).toEqual({});
  });
});
