import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';

const boundary = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    viewerId: 'owner-advisor' as string | null,
    records: [] as LiveCrmRecord[],
    listeners,
    invoke: vi.fn<(command: string) => Promise<unknown>>(),
    setViewer(viewerId: string | null) {
      this.viewerId = viewerId;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
});

vi.mock('@/platform/firm/firmStore', async () => {
  const React = await import('react');
  return {
    useFirmStore: <T,>(
      selector: (state: { session: { userId: string } | null }) => T
    ) =>
      React.useSyncExternalStore(
        (listener) => {
          boundary.listeners.add(listener);
          return () => {
            boundary.listeners.delete(listener);
          };
        },
        () =>
          selector({
            session: boundary.viewerId ? { userId: boundary.viewerId } : null,
          })
      ),
  };
});
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({
    kind: 'refused',
    reason: 'client-required',
    message: 'Choose a client.',
  }),
  readSelectionOperationDecision: () => ({
    kind: 'refused',
    reason: 'client-required',
    message: 'Choose a client.',
  }),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string) => boundary.invoke(command),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));

import {
  LIVE_CRM_RECORDS_CHANGED,
  useLiveCrmRecords,
} from './useLiveCrmRecords';

const meeting: LiveCrmRecord = {
  id: 'meeting-private',
  kind: 'meeting',
  ownerRef: 'owner-advisor',
  visibilityPolicyId: 'private-policy',
};
const task: LiveCrmRecord = {
  id: 'private-task',
  kind: 'task',
  meetingId: meeting.id,
};
const preferences = (
  includedMemberIds: readonly string[] = [],
  excludedMemberIds: readonly string[] = []
): LiveCrmRecord => ({
  id: 'meeting-preferences',
  kind: 'meeting_foundation_preferences',
  visibilityPolicies: [
    {
      id: 'private-policy',
      mode: 'explicit-review',
      includedMemberIds,
      excludedMemberIds,
    },
  ],
});

describe('useLiveCrmRecords meeting visibility reactivity', () => {
  beforeEach(() => {
    boundary.viewerId = 'owner-advisor';
    boundary.listeners.clear();
    boundary.records = [preferences(['included-advisor']), meeting, task];
    boundary.invoke.mockReset().mockImplementation((command) => {
      if (command === 'crm_live_list')
        return Promise.resolve(structuredClone(boundary.records));
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });
  });

  it('removes already-loaded restricted rows immediately when the viewer changes', async () => {
    const { result } = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toContain(
        task.id
      );
    });

    act(() => {
      boundary.setViewer('excluded-advisor');
    });

    expect(result.current.records.map((record) => record.id)).toEqual([
      'meeting-preferences',
    ]);
  });

  it('re-filters after a policy reload and never shows an old async result to the new viewer', async () => {
    let finishOldLoad: ((records: readonly LiveCrmRecord[]) => void) | null =
      null;
    boundary.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOldLoad = resolve;
        })
    );
    const { result } = renderHook(() => useLiveCrmRecords());

    await waitFor(() => {
      expect(finishOldLoad).not.toBeNull();
    });
    act(() => {
      boundary.setViewer('excluded-advisor');
    });
    act(() => {
      finishOldLoad?.(structuredClone(boundary.records));
    });
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toEqual([
        'meeting-preferences',
      ]);
    });

    act(() => {
      boundary.setViewer('included-advisor');
    });
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toContain(
        task.id
      );
    });
    boundary.records = [preferences([], ['included-advisor']), meeting, task];
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toEqual([
        'meeting-preferences',
      ]);
    });
  });
});
