import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';

const workspace = vi.hoisted(() => ({
  state: {
    rootPath: '/workspace-policy',
    rootGeneration: 1,
  } as { rootPath: string | null; rootGeneration: number },
}));

const backend = vi.hoisted(() => ({
  activeRoot: '/workspace-policy',
  recordsByRoot: new Map<string, LiveCrmRecord[]>(),
  holdLists: false,
  pendingLists: [] as Array<{
    root: string;
    resolve: (records: readonly LiveCrmRecord[]) => void;
  }>,
  upserts: [] as Array<{ root: string; record: LiveCrmRecord }>,
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const useWorkspaceStore = Object.assign(
    <T,>(selector: (state: typeof workspace.state) => T): T =>
      selector(workspace.state),
    { getState: () => workspace.state }
  );
  return { useWorkspaceStore };
});

vi.mock('@/platform/client-context', () => {
  const decision = {
    kind: 'matter' as const,
    sourceKind: 'matter' as const,
    matter: { id: 'same-client-id' },
    client: {
      provider: 'wealthbox' as const,
      householdId: 'same-household-id',
      displayName: 'Same client',
    },
  };
  return {
    useSelectionOperationDecision: () => decision,
    readSelectionOperationDecision: () => decision,
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => {
    const root = backend.activeRoot;
    if (command === 'crm_live_list') {
      if (backend.holdLists) {
        return new Promise<readonly LiveCrmRecord[]>((resolve) => {
          backend.pendingLists.push({ root, resolve });
        });
      }
      return Promise.resolve(
        structuredClone(backend.recordsByRoot.get(root) ?? [])
      );
    }
    if (command === 'crm_live_upsert' && args?.record) {
      const saved = structuredClone(args.record);
      const current = backend.recordsByRoot.get(root) ?? [];
      backend.recordsByRoot.set(
        root,
        current.some((record) => record.id === saved.id)
          ? current.map((record) => (record.id === saved.id ? saved : record))
          : [...current, saved]
      );
      backend.upserts.push({ root, record: saved });
      return Promise.resolve(saved);
    }
    return Promise.reject(new Error(`Unexpected command ${command}`));
  },
}));

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (root: string) => {
    backend.activeRoot = root;
    return Promise.resolve();
  },
}));

vi.mock('./store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));

vi.mock('./liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

import { useLiveCrmRecords } from './useLiveCrmRecords';

const oldPreferences: LiveCrmRecord = {
  id: 'meeting-foundation-preferences',
  kind: 'meeting_foundation_preferences',
  matterId: 'same-client-id',
  visibilityPolicies: [
    {
      id: 'private-meeting',
      mode: 'explicit-review',
      includedMemberIds: ['member-b'],
      excludedMemberIds: [],
    },
  ],
};

describe('live CRM shared snapshot and workspace isolation', () => {
  beforeEach(() => {
    workspace.state = { rootPath: '/workspace-policy', rootGeneration: 1 };
    backend.activeRoot = '/workspace-policy';
    backend.recordsByRoot = new Map([
      ['/workspace-policy', [structuredClone(oldPreferences)]],
    ]);
    backend.holdLists = false;
    backend.pendingLists = [];
    backend.upserts = [];
  });

  afterEach(() => {
    backend.holdLists = false;
    for (const pending of backend.pendingLists.splice(0)) {
      pending.resolve(
        structuredClone(backend.recordsByRoot.get(pending.root) ?? [])
      );
    }
    vi.clearAllMocks();
  });

  it('a stale second mounted hook cannot restore a policy revoked by the first hook', async () => {
    const first = renderHook(() => useLiveCrmRecords());
    const staleSecond = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(first.result.current.records).toHaveLength(1);
      expect(staleSecond.result.current.records).toHaveLength(1);
    });

    // Keep event-triggered reloads in flight so hook B genuinely retains its
    // older local ref. The shared per-workspace snapshot must still win.
    backend.holdLists = true;
    const revoked = {
      ...oldPreferences,
      visibilityPolicies: [
        {
          id: 'private-meeting',
          mode: 'explicit-review',
          includedMemberIds: [],
          excludedMemberIds: ['member-b'],
        },
      ],
    } satisfies LiveCrmRecord;
    await act(async () => {
      await first.result.current.save(revoked);
    });

    act(() => {
      staleSecond.result.current.publishSavedRecord({
        id: 'unrelated-keywords',
        kind: 'meeting_keyword_catalogue',
        matterId: 'same-client-id',
        keywords: ['retirement'],
      });
    });

    expect(
      first.result.current
        .getCurrentRecords()
        .find((record) => record.id === oldPreferences.id)
    ).toMatchObject({
      visibilityPolicies: [
        expect.objectContaining({
          includedMemberIds: [],
          excludedMemberIds: ['member-b'],
        }),
      ],
    });
  });

  it('a held A reader and writer fail closed after A-to-B with the same client ids', async () => {
    backend.recordsByRoot.set('/workspace-a', [
      { ...oldPreferences, workspaceMarker: 'A private value' },
    ]);
    backend.recordsByRoot.set('/workspace-b', [
      { ...oldPreferences, workspaceMarker: 'B private value' },
    ]);
    workspace.state = { rootPath: '/workspace-a', rootGeneration: 10 };
    const hook = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(hook.result.current.records).toEqual([
        expect.objectContaining({ workspaceMarker: 'A private value' }),
      ]);
    });
    const heldA = hook.result.current;

    workspace.state = { rootPath: '/workspace-b', rootGeneration: 11 };
    hook.rerender();
    expect(heldA.getCurrentRecords()).toEqual([]);
    expect(() =>
      heldA.publishSavedRecord({
        id: 'stale-a-write',
        kind: 'meeting_keyword_catalogue',
      })
    ).toThrow('workspace changed');
    await expect(
      heldA.save({ id: 'stale-a-save', kind: 'meeting_keyword_catalogue' })
    ).rejects.toThrow('workspace changed');
    expect(backend.upserts.some(({ record }) => record.id === 'stale-a-save')).toBe(
      false
    );

    await waitFor(() => {
      expect(hook.result.current.records).toEqual([
        expect.objectContaining({ workspaceMarker: 'B private value' }),
      ]);
    });
    expect(heldA.getCurrentRecords()).toEqual([]);

    // Even returning to the same path cannot revive A's held capability: the
    // monotonic generation proves a workspace switch happened in between.
    workspace.state = { rootPath: '/workspace-a', rootGeneration: 12 };
    expect(heldA.getCurrentRecords()).toEqual([]);
  });
});
