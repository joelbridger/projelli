import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  appendNoticeEvidence,
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingFoundationPreferencesStore,
  createMeetingIntelligenceSettingsStore,
  createMeetingSourceAdapter,
  createMeetingStore,
  createMeetingTemplateStore,
  createMeetingTypeStore,
  createNoticeEvidenceReadModel,
  listForHousehold,
  listPrepForHousehold,
  meetingArtifactsForClient,
  validateMeetingArtifactTransition,
  type ClientBoundary,
  type MeetingArtifactRequirement,
} from './contract';

function canonicalPort(initial: readonly LiveCrmRecord[] = []) {
  let canonical = structuredClone(initial) as LiveCrmRecord[];
  const commands: string[] = [];
  return {
    records: structuredClone(canonical),
    workspaceRoot: '/workspace',
    error: null,
    save(record: LiveCrmRecord) {
      commands.push('crm_live_upsert');
      const saved = structuredClone(record);
      canonical = canonical.some((item) => item.id === saved.id)
        ? canonical.map((item) => (item.id === saved.id ? saved : item))
        : [...canonical, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords() {
      commands.push('crm_live_list');
      return Promise.resolve(structuredClone(canonical));
    },
    commands,
    readCanonical: () => structuredClone(canonical),
    replaceCanonical(records: readonly LiveCrmRecord[]) {
      canonical = structuredClone(records) as LiveCrmRecord[];
    },
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
  references: ['existing'],
};

const client: ClientBoundary = {
  householdRef: 'household-1',
  matterId: 'matter-1',
};

const requirements: readonly MeetingArtifactRequirement[] = [
  { kind: 'structured-notes', minimumSchemaVersion: 2 },
  { kind: 'notice-evidence', minimumSchemaVersion: 1 },
];

describe('meetings foundation contract', () => {
  it('preserves unknown fields and merges additive references on update', async () => {
    const live = canonicalPort();
    const store = createMeetingStore({
      ...live,
      sharedMatterId: 'firm-matter-1',
      sharedLocalMatterId: 'matter-1',
    });
    const created = await store.createDraft(draft);
    live.replaceCanonical(
      live
        .readCanonical()
        .map((record) =>
          record.id === created.id
            ? { ...record, futureField: { survives: true } }
            : record
        )
    );

    const freshStore = createMeetingStore({
      ...live,
      records: live.readCanonical(),
    });
    const updated = await freshStore.update(created.id, {
      ownerRef: 'member-2',
      references: ['added', 'existing'],
    });

    expect(updated.references).toEqual(['existing', 'added']);
    expect(
      live.readCanonical().find((record) => record.id === created.id)
    ).toMatchObject({
      futureField: { survives: true },
      relayMatterId: 'firm-matter-1',
      references: ['existing', 'added'],
    });
    expect(live.commands.slice(-2)).toEqual([
      'crm_live_upsert',
      'crm_live_list',
    ]);
    await expect(
      createMeetingStore({
        ...live,
        sharedMatterId: 'firm-matter-1',
        sharedLocalMatterId: 'matter-1',
      }).createDraft({ ...draft, matterId: 'matter-2' })
    ).rejects.toThrow('active shared client');
  });

  it('rejects impossible calendar dates instead of normalizing them', async () => {
    const store = createMeetingStore(canonicalPort());
    await expect(
      store.createDraft({
        ...draft,
        scheduledStartUtc: '2026-02-30T09:00:00.000Z',
      })
    ).rejects.toThrow('real ISO timestamp');
  });

  it('allows only legal meeting and artifact transitions', async () => {
    const live = canonicalPort();
    const meeting = await createMeetingStore(live).createDraft(draft);
    const store = createMeetingStore({
      ...live,
      records: live.readCanonical(),
    });
    await expect(
      store.transition(meeting.id, {
        from: 'draft',
        to: 'completed',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).rejects.toThrow('Illegal meeting transition');
    expect(() =>
      validateMeetingArtifactTransition({
        from: 'approved',
        to: 'approved',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).toThrow('Illegal meeting artifact transition');
    expect(() =>
      validateMeetingArtifactTransition({
        from: 'produced',
        to: 'produced',
        at: '2026-07-20T11:00:00.000Z',
      } as never)
    ).toThrow('Illegal meeting artifact transition');
    const artifactStore = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    await expect(
      artifactStore.append({
        meetingId: meeting.id,
        kind: 'summary',
        schemaVersion: 1,
        producedAt: '2026-07-20T10:00:00.000Z',
        approvedAt: '2026-07-20T09:59:00.000Z',
        sourceRefs: [],
        provenance: 'local-entry',
        payload: {},
      })
    ).rejects.toThrow('cannot predate production');
  });

  it('keeps every catalogue/settings public snapshot current after save and fresh get', async () => {
    const live = canonicalPort();
    const types = createMeetingTypeStore(live);
    const templates = createMeetingTemplateStore(live);
    const settings = createMeetingIntelligenceSettingsStore(live);
    const preferences = createMeetingFoundationPreferencesStore(live);

    await types.save([{ id: 'review', label: 'Review' }]);
    await templates.save([
      { id: 'notes', label: 'Notes', artifactKinds: ['structured-notes'] },
    ]);
    await settings.save({
      keywordTrackingEnabled: true,
      clientSignalsEnabled: false,
      displayPreference: 'compact',
    });
    await preferences.save({
      visibilityPolicies: [{ id: 'inherit', mode: 'inherit-household' }],
      owners: [{ id: 'member-1', label: 'Maya' }],
      deferredDescriptors: [
        { id: 'follow-up', kind: 'automation-rule', label: 'Follow-up draft' },
        { id: 'retention', kind: 'retention-policy', label: 'Retention' },
        { id: 'attestation', kind: 'attestation-export', label: 'Attestation' },
      ],
    });

    expect(types.types).toEqual([{ id: 'review', label: 'Review' }]);
    expect(await types.get()).toEqual(types.types);
    expect(templates.templates[0]?.id).toBe('notes');
    expect(settings.settings.displayPreference).toBe('compact');
    expect(preferences.preferences).toMatchObject({
      owners: [{ id: 'member-1', label: 'Maya' }],
      visibilityPolicies: [{ id: 'inherit' }],
    });

    live.replaceCanonical(
      live.readCanonical().map((record) => {
        if (record.kind === 'meeting_template_catalogue')
          return {
            ...record,
            templates: [
              { id: 'bad', label: 'Bad', artifactKinds: ['not-a-kind'] },
            ],
          };
        if (record.kind === 'meeting_intelligence_settings')
          return { ...record, keywordTrackingEnabled: 'not-a-boolean' };
        return record;
      })
    );
    await expect(templates.get()).rejects.toThrow(
      'Meeting template artifact kind is invalid'
    );
    await expect(settings.get()).rejects.toThrow(
      'Meeting intelligence settings are invalid'
    );
  });

  it('enforces household plus matter for household and prep readers', async () => {
    const live = canonicalPort();
    const firstStore = createMeetingStore(live);
    await firstStore.createDraft(draft);
    await createMeetingStore({
      ...live,
      records: live.readCanonical(),
    }).createDraft({
      ...draft,
      matterId: 'matter-2',
      scheduledStartUtc: '2026-07-21T09:00:00.000Z',
      scheduledEndUtc: '2026-07-21T10:00:00.000Z',
    });
    const fresh = createMeetingStore({
      ...live,
      records: live.readCanonical(),
    });
    expect(listForHousehold(fresh, client)).toHaveLength(1);
    expect(listPrepForHousehold(fresh, client)).toHaveLength(1);
    expect(
      listForHousehold(fresh, { ...client, matterId: 'matter-x' })
    ).toEqual([]);
  });

  it('fails closed for wrong client, matter, kind, version, and unapproved artifacts', async () => {
    const live = canonicalPort();
    const meeting = await createMeetingStore(live).createDraft(draft);
    const second = await createMeetingStore({
      ...live,
      records: live.readCanonical(),
    }).createDraft({
      ...draft,
      householdRef: 'household-2',
      matterId: 'matter-2',
      scheduledStartUtc: '2026-07-21T09:00:00.000Z',
      scheduledEndUtc: '2026-07-21T10:00:00.000Z',
    });
    let artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const wrongVersion = await artifacts.append({
      meetingId: meeting.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      approvedAt: '2026-07-20T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Old version' },
    });
    artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const allowed = await artifacts.append({
      meetingId: meeting.id,
      kind: 'structured-notes',
      schemaVersion: 2,
      producedAt: '2026-07-20T10:02:00.000Z',
      approvedAt: '2026-07-20T10:03:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Allowed' },
    });
    artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const otherClient = await artifacts.append({
      meetingId: second.id,
      kind: 'structured-notes',
      schemaVersion: 2,
      producedAt: '2026-07-21T10:00:00.000Z',
      approvedAt: '2026-07-21T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Other client' },
    });
    artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const hostileTarget = await artifacts.append({
      meetingId: meeting.id,
      kind: 'notice-evidence',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:04:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { state: 'shown', displayText: 'Still produced' },
    });
    live.replaceCanonical([
      ...live.readCanonical(),
      {
        id: 'hostile-transition',
        kind: 'meeting_artifact_transition',
        matterId: 'matter-2',
        householdRef: 'household-2',
        createdAt: '2026-07-20T10:05:00.000Z',
        updatedAt: '2026-07-20T10:05:00.000Z',
        artifactId: hostileTarget.id,
        fromState: 'produced',
        toState: 'approved',
        transitionAt: '2026-07-20T10:05:00.000Z',
      },
      {
        id: 'forged-parent-boundary',
        kind: 'meeting_artifact',
        matterId: 'matter-1',
        householdRef: 'household-1',
        createdAt: '2026-07-20T10:06:00.000Z',
        updatedAt: '2026-07-20T10:06:00.000Z',
        meetingId: second.id,
        artifactKind: 'notice-evidence',
        schemaVersion: 1,
        producedAt: '2026-07-20T10:06:00.000Z',
        artifactState: 'produced',
        sourceRefs: [],
        provenance: 'local-entry',
        payload: { state: 'shown', displayText: 'Forged parent' },
      },
    ]);
    const meetings = createMeetingStore({
      ...live,
      records: live.readCanonical(),
    });
    const freshArtifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const scoped = meetingArtifactsForClient(
      meetings,
      freshArtifacts,
      client,
      requirements
    );
    const approved = approvedMeetingArtifactsForClient(
      meetings,
      freshArtifacts,
      client,
      requirements
    );

    expect(
      scoped
        .listForMeeting(meeting.id, ['structured-notes'])
        .map((item) => item.id)
    ).toEqual([allowed.id]);
    expect(scoped.listForMeeting(second.id)).toEqual([]);
    expect(scoped.listForMeeting(meeting.id, ['summary'])).toEqual([]);
    expect(scoped.get(wrongVersion.id)).toBeNull();
    expect(scoped.get(otherClient.id)).toBeNull();
    expect(approved.get(allowed.id)?.payload).toEqual({ summary: 'Allowed' });
    expect(scoped.get(hostileTarget.id)?.state).toBe('produced');
    expect(approved.get(hostileTarget.id)).toBeNull();
    expect(scoped.get('forged-parent-boundary')).toBeNull();
    expect(
      live.readCanonical().find((record) => record.id === allowed.id)
    ).toMatchObject({
      artifactState: 'produced',
    });
    expect(live.readCanonical()).toContainEqual(
      expect.objectContaining({
        kind: 'meeting_artifact_transition',
        artifactId: allowed.id,
        fromState: 'produced',
        toState: 'approved',
      })
    );
  });

  it('keeps notice evidence local and source adapter client-bounded', async () => {
    const live = canonicalPort();
    const meeting = await createMeetingStore(live).createDraft(draft);
    let artifactStore = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const evidence = await appendNoticeEvidence(artifactStore, {
      meetingId: meeting.id,
      state: 'shown',
      timestamp: '2026-07-20T09:00:00.000Z',
      displayText: 'Recording notice shown.',
      provenance: 'local-entry',
    });
    artifactStore = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const notes = await artifactStore.append({
      meetingId: meeting.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      approvedAt: '2026-07-20T10:01:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Client-safe notes' },
    });
    const freshMeetings = createMeetingStore({
      ...live,
      records: live.readCanonical(),
    });
    const freshArtifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const noticeReader = meetingArtifactsForClient(
      freshMeetings,
      freshArtifacts,
      client,
      [{ kind: 'notice-evidence', minimumSchemaVersion: 1 }]
    );
    expect(
      createNoticeEvidenceReadModel(noticeReader).get(evidence.id)
    ).toMatchObject({ state: 'shown' });
    await expect(
      createMeetingSourceAdapter(
        freshMeetings,
        freshArtifacts
      ).listApprovedForClient(client)
    ).resolves.toMatchObject([
      { summary: 'Client-safe notes', sourceArtifactIds: [notes.id] },
    ]);
    expect(
      live.readCanonical().find((record) => record.id === evidence.id)
    ).not.toHaveProperty('recorded');
  });
});
