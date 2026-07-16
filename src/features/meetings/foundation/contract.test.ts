import { describe, expect, it } from 'vitest';
import {
  appendNoticeEvidence,
  availableMeetingPanels,
  approvedMeetingArtifacts,
  composeMeetingPanelRegistry,
  createMeetingArtifactStore,
  createMeetingStore,
  createNoticeEvidenceReadModel,
  createMeetingSourceAdapter,
  createMeetingTemplateStore,
  createMeetingTypeStore,
  type MeetingPanelDescriptor,
} from './contract';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

function port(records: LiveCrmRecord[]) {
  const saved: LiveCrmRecord[] = [];
  return {
    records,
    workspaceRoot: '/workspace',
    error: null,
    save(record: LiveCrmRecord) {
      const index = records.findIndex(
        (candidate) => candidate.id === record.id
      );
      if (index >= 0) records[index] = record;
      else records.push(record);
      saved.push(record);
      return Promise.resolve(record);
    },
    reloadRecords() {
      return Promise.resolve(records);
    },
    saved,
  };
}

const draft = {
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  matterId: 'matter-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
};

describe('meetings foundation contract', () => {
  it('saves a draft through the canonical port, reloads it, and preserves unknown fields on patch', async () => {
    const live = port([]);
    const store = createMeetingStore(live);
    const created = await store.createDraft(draft);
    const raw = live.records[0];
    if (!raw) throw new Error('Expected the created meeting to be stored.');
    raw['futureField'] = { survives: true };
    const updated = await createMeetingStore(live).update(created.id, {
      ownerRef: 'member-2',
    });
    expect(updated.ownerRef).toBe('member-2');
    expect(raw['futureField']).toEqual({ survives: true });
    expect(live.saved).toHaveLength(2);
  });

  it('allows only legal local lifecycle transitions', async () => {
    const live = port([]);
    const created = await createMeetingStore(live).createDraft(draft);
    await expect(
      createMeetingStore(live).transition(created.id, {
        from: 'draft',
        to: 'completed',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).rejects.toThrow('Illegal meeting transition');
    const scheduled = await createMeetingStore(live).transition(created.id, {
      from: 'draft',
      to: 'scheduled',
      at: '2026-07-20T08:00:00.000Z',
    });
    expect(scheduled.state).toBe('scheduled');
  });

  it('saves validated type and template catalogues through the same reload path', async () => {
    const live = port([]);
    await expect(
      createMeetingTypeStore(live).save([{ id: 'review', label: 'Review' }])
    ).resolves.toEqual([{ id: 'review', label: 'Review' }]);
    await expect(
      createMeetingTemplateStore(live).save([
        { id: 'notes', label: 'Notes', artifactKinds: ['structured-notes'] },
      ])
    ).resolves.toEqual([
      { id: 'notes', label: 'Notes', artifactKinds: ['structured-notes'] },
    ]);
    expect(live.records.map((record) => record.kind)).toEqual([
      'meeting_type_catalogue',
      'meeting_template_catalogue',
    ]);
  });

  it('keeps notice evidence append-only and never fabricates capture claims', async () => {
    const live = port([]);
    const meeting = await createMeetingStore(live).createDraft(draft);
    const artifacts = createMeetingArtifactStore(live);
    const evidence = await appendNoticeEvidence(artifacts, {
      meetingId: meeting.id,
      state: 'shown',
      timestamp: '2026-07-20T09:00:00.000Z',
      displayText: 'Recording notice shown.',
      provenance: 'local-entry',
    });
    const read = createNoticeEvidenceReadModel(
      createMeetingArtifactStore(live)
    );
    expect(read.get(evidence.id)).toMatchObject({
      state: 'shown',
      displayText: 'Recording notice shown.',
    });
    expect(
      live.records.find((record) => record.id === evidence.id)
    ).not.toHaveProperty('recorded');
  });

  it('returns approved artifacts only for the requested household', async () => {
    const live = port([]);
    const first = await createMeetingStore(live).createDraft(draft);
    const second = await createMeetingStore(live).createDraft({
      ...draft,
      householdRef: 'household-2',
      matterId: 'matter-2',
      scheduledStartUtc: '2026-07-21T09:00:00.000Z',
      scheduledEndUtc: '2026-07-21T10:00:00.000Z',
    });
    await createMeetingArtifactStore(live).append({
      meetingId: first.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      approvedAt: '2026-07-20T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'First household only' },
    });
    await createMeetingArtifactStore(live).append({
      meetingId: second.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-21T10:00:00.000Z',
      approvedAt: '2026-07-21T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Second household only' },
    });
    const source = createMeetingSourceAdapter(
      createMeetingStore(live),
      approvedMeetingArtifacts(createMeetingArtifactStore(live))
    );
    await expect(
      source.listApprovedForClient({
        householdRef: 'household-1',
        matterId: 'matter-1',
      })
    ).resolves.toMatchObject([{ summary: 'First household only' }]);
  });

  it('accepts a genuine third registry contribution, keeps dark entries out, and rejects duplicates or malformed entries', () => {
    const panel = (id: string, order: number): MeetingPanelDescriptor => ({
      id,
      order,
      isAvailable: () => true,
      render: () => null,
    });
    expect(
      composeMeetingPanelRegistry([
        panel('base', 100),
        panel('second', 200),
        panel('third', 300),
      ]).map((entry) => entry.id)
    ).toEqual(['base', 'second', 'third']);
    const dark: MeetingPanelDescriptor = {
      id: 'dark',
      order: 400,
      isAvailable: () => false,
      render: () => null,
    };
    const context = { meeting: { id: 'meeting-1' } } as never;
    expect(
      availableMeetingPanels(
        context,
        composeMeetingPanelRegistry([panel('base', 100), dark])
      )
    ).toHaveLength(1);
    expect(() =>
      composeMeetingPanelRegistry([panel('base', 100), panel('base', 200)])
    ).toThrow('unique');
    expect(() =>
      composeMeetingPanelRegistry([
        {
          id: 'bad',
          order: Number.NaN,
          isAvailable: () => true,
          render: () => null,
        },
      ])
    ).toThrow('finite');
  });
});
