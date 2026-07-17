import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  appendNoticeEvidence,
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingFoundationPreferencesStore,
  createMeetingPopulationService,
  createMeetingIntelligenceSettingsStore,
  createFirmMeetingDirectoryReader,
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
  type LegacyMeetingLinkValidationContext,
} from './contract';

function canonicalPort(initial: readonly LiveCrmRecord[] = []) {
  let canonical = structuredClone(initial) as LiveCrmRecord[];
  const commands: string[] = [];
  return {
    records: structuredClone(canonical),
    workspaceRoot: '/workspace',
    error: null,
    // Client-scoped stores REQUIRE a live resolver; default the active client to
    // matter-1. Cross-matter constructions override this per store.
    getActiveMatterId: () => 'matter-1' as string | null,
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

function legacyContext(opts?: {
  exists?: boolean;
  metadataMatterId?: string;
  households?: readonly string[];
  folder?: string;
}): LegacyMeetingLinkValidationContext {
  const root = '/workspace';
  const folder = opts?.folder ?? '/workspace/Clients/Household One';
  return {
    workspaceId: 'workspace-1',
    workspaceRoot: root,
    workspace: {
      getRootPath: () => root,
      exists: () => Promise.resolve(opts?.exists ?? true),
      readFile: () =>
        Promise.resolve(
          JSON.stringify({ matterId: opts?.metadataMatterId ?? 'matter-1' })
        ),
    },
    matters: [
      {
        id: 'matter-1',
        name: 'Household One',
        client: 'Household One',
        folderPaths: [folder],
        crmHouseholdKeys: [...(opts?.households ?? ['household-1'])],
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  };
}

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
        // matter-2 is the active client here, so the client check passes and the
        // shared-matter relay check is the one that refuses the mismatch.
        getActiveMatterId: () => 'matter-2',
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
      getActiveMatterId: () => 'matter-2',
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
      getActiveMatterId: () => 'matter-2',
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
      getActiveMatterId: () => 'matter-2',
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

  it('fails closed on the SAME held store as the active client switches A -> B -> none -> A', async () => {
    const live = canonicalPort();
    // The active client is resolved at every operation, so ONE held store pair
    // is scoped by flipping this variable — modelling a real client switch.
    let active: string | null | undefined = 'matter-1';
    const meetings = createMeetingStore({
      ...live,
      getActiveMatterId: () => active,
    });
    const artifacts = createMeetingArtifactStore({
      ...live,
      getActiveMatterId: () => active,
    });
    const readerFor = () =>
      artifacts.readerFor(meetings, client, [
        { kind: 'structured-notes', minimumSchemaVersion: 1 },
      ]);

    // Under A: create a meeting + produced artifact; both are visible.
    const meetingA = await meetings.createDraft(draft);
    const artifactA = await artifacts.append({
      meetingId: meetingA.id,
      kind: 'structured-notes',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'A only' },
    });
    expect(meetings.list.map((meeting) => meeting.id)).toEqual([meetingA.id]);
    expect(readerFor().get(artifactA.id)?.id).toBe(artifactA.id);

    // Switch to B on the SAME stores: every stale-A doorway fails closed.
    active = 'matter-2';
    expect(meetings.list).toEqual([]);
    await expect(meetings.get(meetingA.id)).resolves.toBeUndefined();
    await expect(
      meetings.update(meetingA.id, { ownerRef: 'member-9' })
    ).rejects.toThrow('different client');
    await expect(
      meetings.transition(meetingA.id, {
        from: 'draft',
        to: 'scheduled',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).rejects.toThrow('different client');
    await expect(
      artifacts.append({
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
      artifacts.approve(artifactA.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('different client');
    expect(readerFor().get(artifactA.id)).toBeNull();
    expect(readerFor().listForMeeting(meetingA.id)).toEqual([]);

    // Switch to none (null): still fully fail closed.
    active = null;
    expect(meetings.list).toEqual([]);
    await expect(meetings.get(meetingA.id)).resolves.toBeUndefined();
    await expect(
      meetings.transition(meetingA.id, {
        from: 'draft',
        to: 'scheduled',
        at: '2026-07-20T11:00:00.000Z',
      })
    ).rejects.toThrow('different client');
    await expect(
      artifacts.approve(artifactA.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      })
    ).rejects.toThrow('different client');
    expect(readerFor().get(artifactA.id)).toBeNull();

    // Back to A: nothing was corrupted; the same doorways work again.
    active = 'matter-1';
    expect(meetings.list.map((meeting) => meeting.id)).toEqual([meetingA.id]);
    await expect(meetings.get(meetingA.id)).resolves.toMatchObject({
      id: meetingA.id,
    });
    await expect(
      artifacts.approve(artifactA.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:06:00.000Z',
      })
    ).resolves.toMatchObject({ state: 'approved' });
  });

  it('refuses a stale transition or approval whose stated from does not match reality', async () => {
    const live = canonicalPort();
    const store = createMeetingStore({
      ...live,
      getActiveMatterId: () => 'matter-1',
    });
    const meeting = await store.createDraft(draft);
    // Legitimately advance draft -> scheduled.
    await createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => 'matter-1',
    }).transition(meeting.id, {
      from: 'draft',
      to: 'scheduled',
      at: '2026-07-20T10:30:00.000Z',
    });
    // A stale caller still believes it is a draft; a legal draft->cancelled is
    // refused because the stored state is now scheduled (no silent coercion).
    await expect(
      createMeetingStore({
        ...live,
        records: live.readCanonical(),
        getActiveMatterId: () => 'matter-1',
      }).transition(meeting.id, {
        from: 'draft',
        to: 'cancelled',
        at: '2026-07-20T10:40:00.000Z',
      })
    ).rejects.toThrow('refusing a stale transition');

    // Reviewer's exact probe: illegal approved->approved against a PRODUCED
    // artifact must be refused, not coerced to produced->approved and persisted.
    let artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => 'matter-1',
    });
    const produced = await artifacts.append({
      meetingId: meeting.id,
      kind: 'transcript',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {},
    });
    artifacts = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => 'matter-1',
    });
    await expect(
      artifacts.approve(produced.id, {
        from: 'approved',
        to: 'approved',
        at: '2026-07-20T10:05:00.000Z',
      })
    ).rejects.toThrow('Illegal meeting artifact transition');
    // The artifact is still produced — the hostile call changed nothing.
    expect(
      live.readCanonical().find((record) => record.id === produced.id)
    ).toMatchObject({ artifactState: 'produced' });
    expect(
      live
        .readCanonical()
        .some((record) => record.kind === 'meeting_artifact_transition')
    ).toBe(false);

    // A genuine produced->approved succeeds; a second stale produced->approved
    // against the now-approved artifact is refused.
    const approver = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => 'matter-1',
    });
    await approver.approve(produced.id, {
      from: 'produced',
      to: 'approved',
      at: '2026-07-20T10:06:00.000Z',
    });
    await expect(
      createMeetingArtifactStore({
        ...live,
        records: live.readCanonical(),
        getActiveMatterId: () => 'matter-1',
      }).approve(produced.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:07:00.000Z',
      })
    ).rejects.toThrow('refusing a stale approval');
  });

  it('cannot construct a client-scoped store without a live resolver, and no-active-client fails closed', async () => {
    const live = canonicalPort();

    // The DOCUMENTED construction (a live getActiveMatterId resolver) is safe:
    // this is the only shape the type system permits.
    let active: string | null = 'matter-1';
    const documented = createMeetingStore({
      ...live,
      getActiveMatterId: () => active,
    });
    const meeting = await documented.createDraft(draft);
    active = 'matter-2';
    await expect(documented.get(meeting.id)).resolves.toBeUndefined();
    active = 'matter-1';

    // The isolation-LESS construction is a COMPILE ERROR — a store with no live
    // client resolver cannot be built (this is the pre-fix unsafe shape).
    const { getActiveMatterId: _dropped, ...portWithoutResolver } = live;
    void _dropped;
    // @ts-expect-error getActiveMatterId is required: the isolation-less store cannot be built.
    void createMeetingStore(portWithoutResolver);
    // @ts-expect-error getActiveMatterId is required for the artifact store too.
    void createMeetingArtifactStore(portWithoutResolver);

    // A resolver that returns no active client (null or undefined) fails closed
    // at runtime — nothing is listed, read, or mutated.
    const noneNull = createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => null,
    });
    expect(noneNull.list).toEqual([]);
    await expect(noneNull.get(meeting.id)).resolves.toBeUndefined();
    await expect(
      noneNull.update(meeting.id, { ownerRef: 'x' })
    ).rejects.toThrow('different client');
    const noneUndefined = createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveMatterId: () => undefined,
    });
    expect(noneUndefined.list).toEqual([]);
  });

  it('creates, durably links, and opens only an exactly-one-matter legacy meeting', async () => {
    const live = canonicalPort();
    const service = createMeetingPopulationService(live, legacyContext());
    const linked = await service.createAndLink(draft, {
      meetingDir: 'Clients/Household One/Meetings/2026-07-20',
    });
    expect(linked.legacyLink?.meetingDir).toBe(
      'Clients/Household One/Meetings/2026-07-20'
    );

    // A fresh reader receives the real saved canonical record, not a held
    // object from the creator. The same link is idempotent and cannot replace
    // itself with another folder.
    const fresh = createMeetingPopulationService(
      { ...live, records: live.readCanonical() },
      legacyContext()
    );
    await expect(
      fresh.linkLegacy(linked.id, {
        meetingDir: 'Clients/Household One/Meetings/2026-07-20',
      })
    ).resolves.toMatchObject({ id: linked.id });
    await expect(
      fresh.linkLegacy(linked.id, {
        meetingDir: 'Clients/Household One/Meetings/replacement',
      })
    ).rejects.toThrow('cannot replace');

    const target = await fresh.openTarget(linked.id);
    expect(target).toMatchObject({
      kind: 'linked-legacy-meeting',
      meeting: { id: linked.id, matterId: 'matter-1' },
      client: { householdRef: 'household-1', matterId: 'matter-1' },
      meetingDir: '/workspace/Clients/Household One/Meetings/2026-07-20',
    });
  });

  it('fails closed for false legacy identity and cross-device availability', async () => {
    const live = canonicalPort();
    const created = await createMeetingStore(live).createDraft(draft);
    const input = { meetingDir: 'Clients/Household One/Meetings/2026-07-20' };
    await expect(
      createMeetingStore({ ...live, records: live.readCanonical() }).linkLegacy(
        created.id,
        input,
        legacyContext({ metadataMatterId: 'matter-2' })
      )
    ).rejects.toThrow('different matter');
    await expect(
      createMeetingStore({ ...live, records: live.readCanonical() }).linkLegacy(
        created.id,
        input,
        legacyContext({ households: ['household-1', 'household-2'] })
      )
    ).rejects.toThrow('exactly one');
    await expect(
      createMeetingStore({ ...live, records: live.readCanonical() }).linkLegacy(
        created.id,
        { meetingDir: '../other-client' },
        legacyContext()
      )
    ).rejects.toThrow('normalized and traversal-free');

    const linked = await createMeetingStore({
      ...live,
      records: live.readCanonical(),
    }).linkLegacy(created.id, input, legacyContext());
    await expect(
      createMeetingPopulationService(
        { ...live, records: live.readCanonical() },
        legacyContext({ exists: false })
      ).openTarget(linked.id)
    ).rejects.toThrow('unavailable on this device');
  });

  it('reads a firm directory only through a current explicit authorization', async () => {
    const live = canonicalPort();
    const store = createMeetingStore(live);
    await store.createDraft(draft);
    let authorized = false;
    const reader = createFirmMeetingDirectoryReader(live, {
      isAuthorized: () => authorized,
      allowedMatterIds: () => ['matter-1'],
    });
    await expect(reader.list()).resolves.toEqual([]);
    authorized = true;
    await expect(reader.list()).resolves.toHaveLength(1);
    const revokedDuringRead = createFirmMeetingDirectoryReader(live, {
      isAuthorized: () => false,
      allowedMatterIds: () => ['matter-1'],
    });
    await expect(revokedDuringRead.get('anything')).resolves.toBeUndefined();
  });
});
