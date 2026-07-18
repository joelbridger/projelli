import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  load: vi.fn<() => Promise<readonly LiveCrmRecord[]>>(),
  save: vi.fn<(record: LiveCrmRecord) => Promise<LiveCrmRecord>>(),
}));

vi.mock('@/platform/crm/liveRecords', () => ({
  loadLiveCrmRecords: () => boundary.load(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: boundary.records.map((record) => structuredClone(record)),
    workspaceRoot: '/fixture-workspace',
    save: boundary.save,
  }),
}));

import {
  askScopeBuilder,
  sealAskOpenPath,
  useAskConversation,
  type AskOwnerIdentityAdapter,
} from '@/features/ask';
import { createAskSharedClientOwner } from './owner';
import { mintAskClientSnapshotForTest } from '@/features/ask/testing';

interface FixtureClientRef {
  readonly owner: 'fixture-client-owner';
  readonly id: string;
  readonly matterId: string;
}

interface FixtureMeetingRef {
  readonly owner: 'fixture-meeting-owner';
  readonly id: string;
  readonly matterId: string;
}

const owners: AskOwnerIdentityAdapter<FixtureClientRef, FixtureMeetingRef> = {
  isClientReference: (value): value is FixtureClientRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-client-owner',
  clientMatterId: (reference) => reference.matterId,
  sameClient: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
  isMeetingReference: (value): value is FixtureMeetingRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-meeting-owner',
  meetingId: (reference) => reference.id,
  meetingMatterId: (reference) => reference.matterId,
  sameMeeting: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
};

const clientA = mintAskClientSnapshotForTest<FixtureClientRef>({
  contactRef: {
    owner: 'fixture-client-owner',
    id: 'client-a',
    matterId: 'matter-a',
  },
  matterId: 'matter-a',
  revision: 'client-a:1',
});

const clientB = mintAskClientSnapshotForTest<FixtureClientRef>({
  contactRef: {
    owner: 'fixture-client-owner',
    id: 'client-b',
    matterId: 'matter-b',
  },
  matterId: 'matter-b',
  revision: 'client-b:1',
});

const optionsA = { currentClient: clientA, owners } as const;
const now = '2026-07-16T20:00:00.000Z';

// The write path re-resolves the active client LIVE from the owner binding, so
// this suite plays the owner (feature-internal). `activeClient` is the live
// source; flipping it models a real client switch mid-flight.
let activeClient: typeof clientA | null = clientA;
let owner: ReturnType<
  typeof createAskSharedClientOwner<FixtureClientRef, FixtureMeetingRef>
> | null = null;

describe('useAskConversation canonical persistence', () => {
  beforeEach(() => {
    boundary.records = [];
    boundary.load.mockReset();
    boundary.save.mockReset();
    boundary.load.mockImplementation(() =>
      Promise.resolve(boundary.records.map((record) => structuredClone(record)))
    );
    boundary.save.mockImplementation((record) => {
      const saved = structuredClone(record);
      const index = boundary.records.findIndex((item) => item.id === saved.id);
      if (index >= 0) boundary.records[index] = saved;
      else boundary.records.push(saved);
      return Promise.resolve(structuredClone(saved));
    });
    activeClient = clientA;
    owner?.release();
    owner = createAskSharedClientOwner<FixtureClientRef, FixtureMeetingRef>();
    owner.bind({ readCurrentClient: () => activeClient, owners });
  });

  it('saves metadata, a review draft, and selected sources, then reads them from genuinely fresh records', async () => {
    const scope = askScopeBuilder.chosenSources('workspace-a', clientA, [
      'document-a',
    ]);
    const source = {
      sourceId: 'document-a',
      kind: 'document' as const,
      workspaceId: 'workspace-a',
      client: clientA,
      label: 'Plan A',
      availability: 'available' as const,
      citationOpenPath: sealAskOpenPath({
        kind: 'document',
        token: 'document-a',
      }),
    };
    const first = renderHook(() => useAskConversation(optionsA));

    await act(async () => {
      await first.result.current.saveConversation({
        id: 'conversation-a',
        scope,
        title: 'Plan question',
        createdAt: now,
        updatedAt: now,
      });
      await first.result.current.saveReviewDraft({
        id: 'draft-a',
        scope,
        destination: 'task',
        body: 'Review the cited plan.',
        citationIds: ['claim-a'],
        createdAt: now,
        updatedAt: now,
      });
      await first.result.current.saveSourceSelection({
        id: 'selection-a',
        scope,
        sources: [source],
        createdAt: now,
        updatedAt: now,
      });
    });
    expect(boundary.load).toHaveBeenCalledTimes(3);
    first.unmount();

    const fresh = renderHook(() => useAskConversation(optionsA));
    expect(fresh.result.current.conversations).toMatchObject([
      { id: 'conversation-a', title: 'Plan question' },
    ]);
    expect(fresh.result.current.reviewDrafts).toMatchObject([
      { id: 'draft-a', body: 'Review the cited plan.' },
    ]);
    expect(fresh.result.current.sourceSelections).toMatchObject([
      { id: 'selection-a', sources: [{ sourceId: 'document-a' }] },
    ]);

    fresh.unmount();
    const switched = renderHook(() =>
      useAskConversation({ currentClient: clientB, owners })
    );
    expect(switched.result.current.conversations).toEqual([]);
    expect(switched.result.current.reviewDrafts).toEqual([]);
    expect(switched.result.current.sourceSelections).toEqual([]);
    switched.unmount();

    const cleared = renderHook(() =>
      useAskConversation({ currentClient: null, owners })
    );
    expect(cleared.result.current.conversations).toEqual([]);
    expect(cleared.result.current.reviewDrafts).toEqual([]);
    expect(cleared.result.current.sourceSelections).toEqual([]);
  });

  it('rejects malformed payloads and mixed-client selected meetings', async () => {
    boundary.records.push({
      id: 'ask:askConversation:malformed',
      kind: 'askConversation',
      payload: { id: 'malformed' },
    });
    const reader = renderHook(() => useAskConversation(optionsA));
    expect(reader.result.current.conversations).toEqual([]);

    const mixedScope = askScopeBuilder.selectedMeetings<
      FixtureClientRef,
      FixtureMeetingRef
    >('workspace-a', clientA, [
      {
        owner: 'fixture-meeting-owner',
        id: 'meeting-a',
        matterId: 'matter-a',
      },
      {
        owner: 'fixture-meeting-owner',
        id: 'meeting-b',
        matterId: 'matter-b',
      },
    ]);
    await expect(
      reader.result.current.saveConversation({
        id: 'mixed',
        scope: mixedScope,
        title: 'Mixed meetings',
        createdAt: now,
        updatedAt: now,
      })
    ).rejects.toThrow('malformed or stale');
    expect(boundary.save).not.toHaveBeenCalled();
  });

  it('fails closed on a save handle held across a client switch (A -> B / none)', async () => {
    // Obtain the save handle while client A is active.
    const store = renderHook(() => useAskConversation(optionsA));
    const scopeA = askScopeBuilder.chosenSources('workspace-a', clientA, [
      'document-a',
    ]);
    const conversationA = {
      id: 'conversation-a',
      scope: scopeA,
      title: 'Plan question',
      createdAt: now,
      updatedAt: now,
    };
    const heldSave = store.result.current.saveConversation;

    // The active client switches to B, then to none, AFTER the handle was taken.
    for (const next of [clientB, null] as const) {
      activeClient = next;
      boundary.save.mockClear();
      // The held handle re-resolves the active client live at write time and
      // refuses to persist client-A state under the new active client.
      await expect(heldSave(conversationA)).rejects.toThrow(
        'malformed or stale'
      );
      expect(boundary.save).not.toHaveBeenCalled();
    }

    // Back under A, the same held handle writes normally (proves it is the live
    // recheck, not a permanently broken handle).
    activeClient = clientA;
    await expect(heldSave(conversationA)).resolves.toBeUndefined();
    expect(boundary.save).toHaveBeenCalledTimes(1);
  });
});
