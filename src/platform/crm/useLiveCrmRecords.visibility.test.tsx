import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from './liveRecords';
import {
  MEETING_VISIBILITY_MIGRATION_FIELD,
  MEETING_VISIBILITY_MIGRATION_VERSION,
} from './meetingVisibilityMigration';

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
  const state = () => ({
    session: boundary.viewerId ? { userId: boundary.viewerId } : null,
  });
  const useFirmStore = Object.assign(
    <T,>(selector: (value: ReturnType<typeof state>) => T) =>
      React.useSyncExternalStore(
        (listener) => {
          boundary.listeners.add(listener);
          return () => {
            boundary.listeners.delete(listener);
          };
        },
        () => selector(state())
      ),
    { getState: state }
  );
  return {
    useFirmStore,
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
  meetingVisibility: {
    id: 'private-task',
    kind: 'task',
    lineage: 'derived',
    parentRef: { kind: 'meeting-note', id: meeting.id },
    ownerRef: 'owner-advisor',
    visibilityPolicyId: 'private-policy',
  },
};
const derivedRecord = (
  id: string,
  kind: string,
  visibilityKind: 'meeting-artifact' | 'workflow' | 'proposal' | 'activity'
): LiveCrmRecord => ({
  id,
  kind,
  meetingId: meeting.id,
  meetingVisibility: {
    id,
    kind: visibilityKind,
    lineage: 'derived',
    parentRef: { kind: 'meeting-note', id: meeting.id },
    ownerRef: 'owner-advisor',
    visibilityPolicyId: 'private-policy',
  },
});
const artifact = derivedRecord(
  'private-artifact',
  'meeting_artifact',
  'meeting-artifact'
);
const workflow = derivedRecord(
  'private-workflow',
  'crm_workflow_instance',
  'workflow'
);
const proposal = derivedRecord(
  'private-proposal',
  'proposalRecord',
  'proposal'
);
const activity = derivedRecord('private-activity', 'activityEvent', 'activity');
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
  [MEETING_VISIBILITY_MIGRATION_FIELD]: MEETING_VISIBILITY_MIGRATION_VERSION,
});

describe('useLiveCrmRecords meeting visibility reactivity', () => {
  beforeEach(() => {
    boundary.viewerId = 'owner-advisor';
    boundary.listeners.clear();
    boundary.records = [
      preferences(['included-advisor']),
      meeting,
      artifact,
      task,
      workflow,
      proposal,
      activity,
    ];
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
    expect(
      result.current.unfilteredRecordsForInternalMeetingPreferences.find(
        (record) => record.kind === 'meeting_foundation_preferences'
      )?.['visibilityPolicies']
    ).toEqual(preferences(['included-advisor'])['visibilityPolicies']);
    expect(
      result.current.records.some(
        (record) => record.kind === 'meeting_foundation_preferences'
      )
    ).toBe(false);

    act(() => {
      boundary.setViewer('excluded-advisor');
    });

    expect(result.current.records.map((record) => record.id)).toEqual([]);
    expect(JSON.stringify(result.current.records)).not.toContain(
      'included-advisor'
    );
    await expect(result.current.reloadRecords()).resolves.toEqual([]);
    await expect(
      result.current.reloadUnfilteredRecordsForInternalMeetingPreferences()
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'meeting_foundation_preferences' }),
      ])
    );
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
      expect(result.current.records.map((record) => record.id)).toEqual([]);
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
      expect(result.current.records.map((record) => record.id)).toEqual([]);
    });
  });

  it('publishes only an opaque policy version when the same viewer is revoked', async () => {
    boundary.viewerId = 'included-advisor';
    const { result } = renderHook(() => useLiveCrmRecords());
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toContain(
        task.id
      );
    });
    const allowedVersion = result.current.meetingVisibilityPolicyVersion;

    boundary.records = [preferences([], ['included-advisor']), meeting, task];
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });

    await waitFor(() => {
      expect(result.current.records).toEqual([]);
      expect(result.current.meetingVisibilityPolicyVersion).not.toBe(
        allowedVersion
      );
    });
    expect(typeof result.current.meetingVisibilityPolicyVersion).toBe('string');
    expect(
      JSON.stringify(result.current.meetingVisibilityPolicyVersion)
    ).not.toContain('included-advisor');
  });

  it('keeps allowed derived work visible without exposing policy rows and revokes it immediately', async () => {
    const { result } = renderHook(() => useLiveCrmRecords());
    const derived = [
      [artifact, 'meeting-artifact'],
      [task, 'task'],
      [workflow, 'workflow'],
      [proposal, 'proposal'],
      [activity, 'activity'],
    ] as const;
    await waitFor(() => {
      expect(result.current.records.map((record) => record.id)).toEqual(
        expect.arrayContaining(derived.map(([record]) => record.id))
      );
    });
    expect(
      result.current.records.some(
        (record) => record.kind === 'meeting_foundation_preferences'
      )
    ).toBe(false);
    const heldAuthority = result.current.canReadMeetingDerivedRecord;
    for (const [record, kind] of derived) {
      expect(heldAuthority(record, kind)).toBe(true);
    }

    act(() => {
      boundary.setViewer('included-advisor');
    });
    expect(result.current.records.map((record) => record.id)).toEqual(
      expect.arrayContaining(derived.map(([record]) => record.id))
    );
    for (const [record, kind] of derived) {
      expect(result.current.canReadMeetingDerivedRecord(record, kind)).toBe(
        true
      );
    }

    act(() => {
      boundary.setViewer('excluded-advisor');
    });
    expect(result.current.records).toEqual([]);
    for (const [record, kind] of derived) {
      expect(heldAuthority(record, kind)).toBe(false);
    }
  });
});
