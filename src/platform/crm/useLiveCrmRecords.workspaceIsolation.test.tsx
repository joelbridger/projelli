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
  holdUpserts: false,
  pendingUpserts: [] as Array<{
    resolve: (record: LiveCrmRecord) => void;
    saved: LiveCrmRecord;
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

vi.mock('@/platform/matter/matterStore', () => {
  const state = {
    matters: [{ id: 'same-client-id' }],
    activeMatterId: 'same-client-id',
  };
  const useMatterStore = Object.assign(
    <T,>(selector: (value: typeof state) => T): T => selector(state),
    { getState: () => state }
  );
  return { useMatterStore, getMatters: () => state.matters };
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
      if (backend.holdUpserts) {
        return new Promise<LiveCrmRecord>((resolve) => {
          backend.pendingUpserts.push({ resolve, saved });
        });
      }
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
import { useMeetingFoundationPreferencesStore } from '@/features/meetings';

const oldPreferences: LiveCrmRecord = {
  id: 'meeting-foundation-preferences',
  kind: 'meeting_foundation_preferences',
  matterId: 'same-client-id',
  owners: [{ id: 'member-a', label: 'Advisor A' }],
  deferredDescriptors: [],
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
    backend.holdUpserts = false;
    backend.pendingUpserts = [];
    backend.upserts = [];
  });

  afterEach(() => {
    backend.holdLists = false;
    for (const pending of backend.pendingLists.splice(0)) {
      pending.resolve(
        structuredClone(backend.recordsByRoot.get(pending.root) ?? [])
      );
    }
    backend.holdUpserts = false;
    for (const pending of backend.pendingUpserts.splice(0)) {
      pending.resolve(pending.saved);
    }
    vi.clearAllMocks();
  });

  it('a stale second mounted hook cannot restore a policy revoked by the first hook', async () => {
    const first = renderHook(() => useLiveCrmRecords());
    const staleSecond = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(
        first.result.current.unfilteredRecordsForInternalMeetingPreferences
      ).toHaveLength(1);
      expect(
        staleSecond.result.current
          .unfilteredRecordsForInternalMeetingPreferences
      ).toHaveLength(1);
    });

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
        .unfilteredRecordsForInternalMeetingPreferences
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

  it('two mounted stale preference stores merge an unrelated save without resurrecting revoked visibility', async () => {
    const first = renderHook(() => useMeetingFoundationPreferencesStore());
    const second = renderHook(() => useMeetingFoundationPreferencesStore());
    await waitFor(() => {
      expect(first.result.current.preferences.visibilityPolicies).toHaveLength(
        1
      );
      expect(second.result.current.preferences.visibilityPolicies).toHaveLength(
        1
      );
    });
    const staleSecond = second.result.current;

    await act(async () => {
      await first.result.current.save({
        visibilityPolicies: [
          {
            id: 'private-meeting',
            mode: 'explicit-review',
            includedMemberIds: [],
            excludedMemberIds: ['member-b'],
          },
        ],
        owners: [{ id: 'member-a', label: 'Advisor A' }],
        deferredDescriptors: [],
      });
    });

    await act(async () => {
      await staleSecond.save({
        // This is B's stale copy. B changed only owners; the three-way merge
        // must preserve A's newer visibility decision in memory and on disk.
        visibilityPolicies: oldPreferences['visibilityPolicies'] as never,
        owners: [
          { id: 'member-a', label: 'Advisor A' },
          { id: 'member-c', label: 'Advisor C' },
        ],
        deferredDescriptors: [],
      });
    });

    const persisted = backend.recordsByRoot
      .get('/workspace-policy')
      ?.find((record) => record.id === oldPreferences.id);
    expect(persisted).toMatchObject({
      visibilityPolicies: [
        expect.objectContaining({
          includedMemberIds: [],
          excludedMemberIds: ['member-b'],
        }),
      ],
      owners: [
        { id: 'member-a', label: 'Advisor A' },
        { id: 'member-c', label: 'Advisor C' },
      ],
    });
    await waitFor(() => {
      expect(first.result.current.preferences.visibilityPolicies).toEqual(
        persisted?.['visibilityPolicies']
      );
    });
  });

  it('a held A reader and writer fail closed after A-to-B with the same client ids', async () => {
    backend.recordsByRoot.set('/workspace-a', [
      oldPreferences,
      {
        id: 'visible-a',
        kind: 'meeting_keyword_catalogue',
        workspaceMarker: 'A private value',
      },
    ]);
    backend.recordsByRoot.set('/workspace-b', [
      oldPreferences,
      {
        id: 'visible-b',
        kind: 'meeting_keyword_catalogue',
        workspaceMarker: 'B private value',
      },
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
    expect(
      backend.upserts.some(({ record }) => record.id === 'stale-a-save')
    ).toBe(false);

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

  it.each([
    ['A-to-B', false],
    ['A-to-B-to-A', true],
  ] as const)(
    '%s during a held crm_live_upsert never publishes into the current screen',
    async (_label, returnToA) => {
      backend.recordsByRoot.set('/workspace-a-held', [
        oldPreferences,
        {
          id: 'visible-a-held',
          kind: 'meeting_keyword_catalogue',
          workspaceMarker: 'A before held save',
        },
      ]);
      backend.recordsByRoot.set('/workspace-b-held', [
        oldPreferences,
        {
          id: 'visible-b-held',
          kind: 'meeting_keyword_catalogue',
          workspaceMarker: 'B must stay current',
        },
      ]);
      workspace.state = { rootPath: '/workspace-a-held', rootGeneration: 20 };
      const hook = renderHook(() => useLiveCrmRecords());
      await waitFor(() => {
        expect(hook.result.current.records).toEqual([
          expect.objectContaining({ workspaceMarker: 'A before held save' }),
        ]);
      });
      const heldA = hook.result.current;
      backend.holdUpserts = true;
      const pending = heldA.save({
        ...oldPreferences,
        workspaceMarker: 'A persisted at authorized invoke start',
      });
      const rejected = expect(pending).rejects.toThrow('workspace changed');
      await waitFor(() => {
        expect(backend.pendingUpserts).toHaveLength(1);
      });

      workspace.state = { rootPath: '/workspace-b-held', rootGeneration: 21 };
      hook.rerender();
      expect(hook.result.current.records).toEqual([]);
      if (returnToA) {
        workspace.state = { rootPath: '/workspace-a-held', rootGeneration: 22 };
        // Do not rerender before the old IPC returns: even identical path/client
        // IDs cannot make held generation 20 current again.
      }
      const heldUpsert = backend.pendingUpserts.shift();
      if (!heldUpsert) throw new Error('Expected a held upsert.');
      // Release the simulated backend before the new workspace performs its
      // one-time visibility migration; this test holds only the stale A write.
      backend.holdUpserts = false;
      heldUpsert.resolve(heldUpsert.saved);
      await rejected;
      expect(heldA.getCurrentRecords()).toEqual([]);
      if (!returnToA) {
        await waitFor(() => {
          expect(hook.result.current.records).toEqual([
            expect.objectContaining({ workspaceMarker: 'B must stay current' }),
          ]);
        });
      }
    }
  );
});
