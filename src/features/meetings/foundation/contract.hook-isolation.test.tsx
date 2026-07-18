import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

// Hook-layer proof for fail-closed client isolation. The production hooks
// (useMeetingFoundationStore / useMeetingArtifactStore) must resolve the active
// client LIVE at every operation, never snapshot it at store-grab. So a store
// held across a client switch — including one held across an in-flight await —
// fails closed on the now-stale client without re-grabbing the store.
const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke:
    vi.fn<
      (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
    >(),
}));
// The LIVE active-client source. Flipping this models a real client switch.
const matter = vi.hoisted(() => ({
  state: {
    matters: [{ id: 'matter-1' }] as {
      id: string;
      shared?: boolean;
      firmMatterId?: string;
    }[],
    activeMatterId: 'matter-1' as string | null,
  },
}));
const selection = vi.hoisted(() => ({
  forcedRefusal: null as null | { reason: string; message: string },
}));

function selectionDecision() {
  if (selection.forcedRefusal) {
    return {
      kind: 'refused' as const,
      reason: selection.forcedRefusal.reason,
      message: selection.forcedRefusal.message,
    };
  }
  const active = matter.state.activeMatterId;
  return active
    ? {
        kind: 'matter' as const,
        sourceKind: 'matter-only' as const,
        matter: { id: active },
        client: null,
      }
    : {
        kind: 'refused' as const,
        reason: 'all-matters-not-allowed' as const,
        message: 'Choose one client and try again.',
      };
}

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => selectionDecision(),
  readSelectionOperationDecision: () => selectionDecision(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => {
  const useMatterStore = Object.assign(
    <T,>(selector: (s: typeof matter.state) => T): T => selector(matter.state),
    { getState: () => matter.state }
  );
  return { useMatterStore };
});
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
  setCrmEngineFreshness: vi.fn(),
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

import {
  useMeetingArtifactStore,
  useMeetingFoundationStore,
  useMeetingKeywordCatalogueStore,
} from './contract';

const draft = {
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  matterId: 'matter-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
  references: ['existing'],
};
const clientA = { householdRef: 'household-1', matterId: 'matter-1' };

describe('meetings hook-layer client isolation', () => {
  beforeEach(() => {
    boundary.records = [];
    matter.state.matters = [{ id: 'matter-1' }];
    matter.state.activeMatterId = 'matter-1';
    selection.forcedRefusal = null;
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list')
        return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const saved = structuredClone(args.record);
        boundary.records = boundary.records.some((i) => i.id === saved.id)
          ? boundary.records.map((i) => (i.id === saved.id ? saved : i))
          : [...boundary.records, saved];
        return Promise.resolve(saved);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a store grabbed under A fails closed after the active client switches to B/none — without re-grabbing', async () => {
    const meetings = renderHook(() => useMeetingFoundationStore());
    const artifacts = renderHook(() => useMeetingArtifactStore());

    const meetingA = await meetings.result.current.createDraft(draft);
    const artifactA = await artifacts.result.current.append({
      meetingId: meetingA.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'A only' },
    });

    // HOLD these exact store instances; never re-grab after the switch.
    const heldMeetings = meetings.result.current;
    const heldArtifacts = artifacts.result.current;
    const readerFor = () =>
      heldArtifacts.readerFor(heldMeetings, clientA, [
        { kind: 'structured-notes', minimumSchemaVersion: 1 },
      ]);
    await expect(heldMeetings.get(meetingA.id)).resolves.toMatchObject({
      id: meetingA.id,
    });
    expect(readerFor().get(artifactA.id)?.id).toBe(artifactA.id);

    // Switch to client B behind the held store's back.
    matter.state.activeMatterId = 'matter-2';
    expect(heldMeetings.list).toEqual([]);
    await expect(heldMeetings.get(meetingA.id)).resolves.toBeUndefined();
    await expect(
      heldMeetings.update(meetingA.id, { ownerRef: 'member-9' })
    ).rejects.toThrow('different client');
    await expect(
      heldMeetings.transition(meetingA.id, {
        from: 'draft',
        to: 'scheduled',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).rejects.toThrow('different client');
    await expect(
      heldArtifacts.append({
        meetingId: meetingA.id,
        kind: 'summary',
        schemaVersion: 1,
        producedAt: '2026-07-20T10:05:00.000Z',
        sourceRefs: [],
        provenance: 'local-entry',
        payload: {},
      })
    ).rejects.toThrow('different client');
    await expect(
      heldArtifacts.approve(artifactA.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('different client');
    expect(readerFor().get(artifactA.id)).toBeNull();
    expect(readerFor().listForMeeting(meetingA.id)).toEqual([]);

    // Switch to no client: still fully fail closed.
    matter.state.activeMatterId = null;
    expect(heldMeetings.list).toEqual([]);
    await expect(heldMeetings.get(meetingA.id)).resolves.toBeUndefined();
    await expect(
      heldArtifacts.approve(artifactA.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('Choose one client');

    // Back to A on the SAME held store: it works again, nothing corrupted.
    matter.state.activeMatterId = 'matter-1';
    await expect(heldMeetings.get(meetingA.id)).resolves.toMatchObject({
      id: meetingA.id,
    });
    expect(readerFor().get(artifactA.id)?.id).toBe(artifactA.id);
  });

  it('an approve started under A that switches to B mid-await does not land on A', async () => {
    const meetings = renderHook(() => useMeetingFoundationStore());
    const artifacts = renderHook(() => useMeetingArtifactStore());

    const meetingA = await meetings.result.current.createDraft(draft);
    const artifactA = await artifacts.result.current.append({
      meetingId: meetingA.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'A only' },
    });
    const heldArtifacts = artifacts.result.current;

    // Start the approve under A, then switch to B BEFORE its await resolves.
    const pending = heldArtifacts.approve(artifactA.id, {
      from: 'produced',
      to: 'approved',
      at: '2026-07-20T10:06:00.000Z',
    });
    matter.state.activeMatterId = 'matter-2';
    await expect(pending).rejects.toThrow('different client');

    // A's artifact never became approved; no transition record was written.
    matter.state.activeMatterId = 'matter-1';
    const reader = artifacts.result.current.readerFor(
      meetings.result.current,
      clientA,
      [{ kind: 'structured-notes', minimumSchemaVersion: 1 }]
    );
    expect(reader.get(artifactA.id)?.state).toBe('produced');
    expect(
      boundary.records.some(
        (record) => record.kind === 'meeting_artifact_transition'
      )
    ).toBe(false);
  });

  it('surfaces forced source/follower disagreement and refuses list, read, mutation, append, approve, and artifact reads', async () => {
    const meetings = renderHook(() => useMeetingFoundationStore());
    const artifacts = renderHook(() => useMeetingArtifactStore());
    const keywords = renderHook(() => useMeetingKeywordCatalogueStore());
    const meeting = await meetings.result.current.createDraft(draft);
    const artifact = await artifacts.result.current.append({
      meetingId: meeting.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {},
    });

    selection.forcedRefusal = {
      reason: 'follower-disagreement',
      message: 'The client selection is still catching up. Wait a moment and try again.',
    };
    keywords.rerender();

    expect(meetings.result.current.error).toContain('still catching up');
    expect(keywords.result.current.error).toContain('still catching up');
    expect(meetings.result.current.list).toEqual([]);
    await expect(meetings.result.current.get(meeting.id)).resolves.toBeUndefined();
    await expect(
      meetings.result.current.update(meeting.id, { ownerRef: 'member-2' }),
    ).rejects.toThrow('still catching up');
    await expect(
      artifacts.result.current.append({
        meetingId: meeting.id,
        kind: 'summary',
        schemaVersion: 1,
        producedAt: '2026-07-20T10:05:00.000Z',
        sourceRefs: [],
        provenance: 'local-entry',
        payload: {},
      }),
    ).rejects.toThrow('still catching up');
    await expect(
      artifacts.result.current.approve(artifact.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      }),
    ).rejects.toThrow('still catching up');
    expect(
      artifacts.result.current
        .readerFor(meetings.result.current, clientA, [
          { kind: 'structured-notes', minimumSchemaVersion: 1 },
        ])
        .get(artifact.id),
    ).toBeNull();
  });
});
