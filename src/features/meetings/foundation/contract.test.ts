import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: (
      request: Parameters<typeof actual.readSelectionOperationDecision>[0]
    ) => {
      const selection = meetingBoundaryMint.selection;
      return selection
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: selection.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: selection.householdRef,
              displayName: selection.householdRef,
            },
          }
        : actual.readSelectionOperationDecision(request);
    },
  };
});
import {
  appendNoticeEvidence,
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createLegacyMeetingLinkStatusReader,
  createMeetingFoundationPreferencesStore,
  createMeetingKeywordCatalogueStore,
  createMeetingPopulationService,
  createMeetingIntelligenceSettingsStore,
  createFirmMeetingDirectoryReader,
  createMeetingSourceAdapter,
  createMeetingStore,
  createMeetingTemplateStore,
  createMeetingTypeStore,
  createNoticeEvidenceReadModel,
  grantFirmMeetingDirectoryAccess,
  listForHousehold,
  listPrepForHousehold,
  readActiveMeetingClientBoundary,
  meetingArtifactsForClient,
  validateMeetingArtifactTransition,
  verifyMeetingOpenTarget,
  verifyLegacyMeetingLinkStatus,
  validateMeetingKeywordCatalogue,
  type SealedMeetingClientBoundary,
  type MeetingArtifactRequirement,
  type MeetingOpenTarget,
  type LegacyMeetingLinkStatus,
} from './contract';
import { readReviewNeededMeetingArtifacts } from '../reviewArtifacts';
import {
  MEETING_VISIBILITY_LEGACY_VALUE,
  MEETING_VISIBILITY_LINEAGE_FIELD,
} from '@/platform/crm/meetingVisibilityMigration';

function sealedBoundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = { householdRef, matterId };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected live-authority meeting boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

function boundaryForMatter(
  matterId: string | null | undefined
): SealedMeetingClientBoundary | null {
  if (matterId === null || matterId === undefined) return null;
  const suffix = matterId.replace(/^matter-/, '');
  return sealedBoundary(`household-${suffix}`, matterId);
}

/**
 * Seed the TRUSTED authority the contract derives from — the platform matter
 * store and the active workspace filesystem. Tests drive the REAL derivation
 * path; nothing identity-bearing is handed to the public functions. Returns a
 * mutable fake workspace whose behaviour (symlinks, existence, metadata) each
 * probe can shape.
 */
interface FakeWorkspaceOptions {
  root?: string;
  exists?: boolean;
  metadataMatterId?: string;
  symlinks?: Record<string, string>;
  resolveSymlink?: boolean;
}
function seedTrustedAuthority(opts?: {
  matters?: readonly Matter[];
  households?: readonly string[];
  folder?: string;
  workspace?: FakeWorkspaceOptions;
}): void {
  const root = opts?.workspace?.root ?? '/workspace';
  const folder = opts?.folder ?? '/workspace/Clients/Household One';
  const matters: readonly Matter[] = opts?.matters ?? [
    {
      id: 'matter-1',
      name: 'Household One',
      client: 'Household One',
      folderPaths: [folder],
      crmHouseholdKeys: [...(opts?.households ?? ['household-1'])],
      createdAt: '2026-07-01T00:00:00.000Z',
    } as Matter,
  ];
  useMatterStore.setState({ matters: matters as Matter[] });
  const wsOpts = opts?.workspace;
  const symlinks = wsOpts?.symlinks ?? {};
  const workspace = {
    getRootPath: () => root,
    exists: () => Promise.resolve(wsOpts?.exists ?? true),
    readFile: () =>
      Promise.resolve(
        JSON.stringify({ matterId: wsOpts?.metadataMatterId ?? 'matter-1' })
      ),
    isSymlink: (path: string) => Promise.resolve(path in symlinks),
    ...(wsOpts?.resolveSymlink === false
      ? {}
      : {
          resolveSymlink: (path: string) =>
            Promise.resolve(symlinks[path] ?? path),
        }),
  };
  setActiveWorkspaceService(workspace as unknown as WorkspaceService);
}

function canonicalPort(initial: readonly LiveCrmRecord[] = []) {
  let canonical = structuredClone(initial) as LiveCrmRecord[];
  const commands: string[] = [];
  return {
    records: structuredClone(canonical),
    workspaceRoot: '/workspace',
    error: null,
    // Client-scoped stores REQUIRE a live resolver; default the active client to
    // matter-1. Cross-matter constructions override this per store.
    getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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

const client = sealedBoundary('household-1', 'matter-1');

const LEGACY_DIR = 'Clients/Household One/Meetings/2026-07-20';

afterEach(() => {
  setActiveWorkspaceService(null);
  useMatterStore.setState({ matters: [] });
});

const requirements: readonly MeetingArtifactRequirement[] = [
  { kind: 'structured-notes', minimumSchemaVersion: 2 },
  { kind: 'notice-evidence', minimumSchemaVersion: 1 },
];

describe('meetings foundation contract', () => {
  it('persists exactly one visibility state for new and updated meetings', async () => {
    const live = canonicalPort();
    const store = createMeetingStore(live);
    const created = await store.createDraft(draft);
    expect(live.readCanonical().find((record) => record.id === created.id)).toMatchObject({
      [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
    });

    await store.update(created.id, { visibilityPolicyId: 'private-policy' });
    const restricted = live.readCanonical().find((record) => record.id === created.id);
    expect(restricted).toMatchObject({ visibilityPolicyId: 'private-policy' });
    expect(restricted).not.toHaveProperty(MEETING_VISIBILITY_LINEAGE_FIELD);

    await store.update(created.id, { visibilityPolicyId: null });
    const unrestricted = live.readCanonical().find((record) => record.id === created.id);
    expect(unrestricted).not.toHaveProperty('visibilityPolicyId');
    expect(unrestricted).toMatchObject({
      [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
    });
  });

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
        getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
      }).createDraft({
        ...draft,
        householdRef: 'household-2',
        matterId: 'matter-2',
      })
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

  it('durably round-trips a validated keyword catalogue and fails closed on invalid terms', async () => {
    const live = canonicalPort();
    const keywords = createMeetingKeywordCatalogueStore(live);

    await expect(
      keywords.save(['  Retirement  ', 'Tax planning'])
    ).resolves.toEqual(['Retirement', 'Tax planning']);
    expect(keywords.terms).toEqual(['Retirement', 'Tax planning']);
    expect(
      live
        .readCanonical()
        .find((record) => record.kind === 'meeting_keyword_catalogue')
    ).toMatchObject({
      matterId: 'firm_home',
      terms: ['Retirement', 'Tax planning'],
    });
    await expect(
      createMeetingKeywordCatalogueStore({
        ...live,
        records: live.readCanonical(),
      }).get()
    ).resolves.toEqual(['Retirement', 'Tax planning']);

    await expect(keywords.save(['Retirement', 'retirement'])).rejects.toThrow(
      'Meeting keyword terms must be unique'
    );
    expect(() => validateMeetingKeywordCatalogue(['  '])).toThrow(
      'Meeting keyword term must not be empty'
    );
    expect(() =>
      validateMeetingKeywordCatalogue(
        Array.from({ length: 201 }, (_, i) => `term-${String(i)}`)
      )
    ).toThrow('at most 200 terms');
    expect(() => validateMeetingKeywordCatalogue(['x'.repeat(81)])).toThrow(
      'at most 80 characters'
    );

    live.replaceCanonical(
      live
        .readCanonical()
        .map((record) =>
          record.kind === 'meeting_keyword_catalogue'
            ? { ...record, terms: ['valid', 'VALID'] }
            : record
        )
    );
    await expect(keywords.get()).rejects.toThrow(
      'Meeting keyword terms must be unique'
    );
  });

  it('enforces household plus matter for household and prep readers', async () => {
    const live = canonicalPort();
    const firstStore = createMeetingStore(live);
    await firstStore.createDraft(draft);
    await createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
    }).createDraft({
      ...draft,
      householdRef: 'household-2',
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
      getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
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
      getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
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
      getActiveClientBoundary: () => boundaryForMatter(active),
    });
    const artifacts = createMeetingArtifactStore({
      ...live,
      getActiveClientBoundary: () => boundaryForMatter(active),
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

  it('fails closed when only the household changes and the matter id stays the same', async () => {
    const live = canonicalPort();
    let active = sealedBoundary('household-1', 'matter-1');
    const meetings = createMeetingStore({
      ...live,
      getActiveClientBoundary: () => active,
    });
    const artifacts = createMeetingArtifactStore({
      ...live,
      getActiveClientBoundary: () => active,
    });
    const meeting = await meetings.createDraft(draft);
    const artifact = await artifacts.append({
      meetingId: meeting.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {},
    });

    active = sealedBoundary('household-2', 'matter-1');
    expect(meetings.list).toEqual([]);
    await expect(meetings.get(meeting.id)).resolves.toBeUndefined();
    await expect(meetings.update(meeting.id, { ownerRef: 'other' })).rejects.toThrow(
      'different client'
    );
    await expect(
      artifacts.approve(artifact.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:01:00.000Z',
      })
    ).rejects.toThrow('different client');
    expect(
      artifacts
        .readerFor(meetings, client, [
          { kind: 'summary', minimumSchemaVersion: 1 },
        ])
        .get(artifact.id)
    ).toBeNull();
  });

  it('refuses a stale transition or approval whose stated from does not match reality', async () => {
    const live = canonicalPort();
    const store = createMeetingStore({
      ...live,
      getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
    });
    const meeting = await store.createDraft(draft);
    // Legitimately advance draft -> scheduled.
    await createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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
        getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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
      getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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
      getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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
      getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
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
        getActiveClientBoundary: () => sealedBoundary('household-1', 'matter-1'),
      }).approve(produced.id, {
        from: 'produced',
        to: 'approved',
        at: '2026-07-20T10:07:00.000Z',
      })
    ).rejects.toThrow('refusing a stale approval');
  });

  it('cannot construct a client-scoped store without a live resolver, and no-active-client fails closed', async () => {
    const live = canonicalPort();

    // The documented construction uses one live sealed household + matter pair.
    // this is the only shape the type system permits.
    let active: string | null = 'matter-1';
    const documented = createMeetingStore({
      ...live,
      getActiveClientBoundary: () => boundaryForMatter(active),
    });
    const meeting = await documented.createDraft(draft);
    active = 'matter-2';
    await expect(documented.get(meeting.id)).resolves.toBeUndefined();
    active = 'matter-1';

    // The isolation-LESS construction is a COMPILE ERROR — a store with no live
    // client resolver cannot be built (this is the pre-fix unsafe shape).
    const { getActiveClientBoundary: _dropped, ...portWithoutResolver } = live;
    void _dropped;
    // @ts-expect-error getActiveClientBoundary is required: the isolation-less store cannot be built.
    void createMeetingStore(portWithoutResolver);
    // @ts-expect-error getActiveClientBoundary is required for the artifact store too.
    void createMeetingArtifactStore(portWithoutResolver);

    // A resolver that returns no active client (null or undefined) fails closed
    // at runtime — nothing is listed, read, or mutated.
    const noneNull = createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveClientBoundary: () => null,
    });
    expect(noneNull.list).toEqual([]);
    await expect(noneNull.get(meeting.id)).resolves.toBeUndefined();
    await expect(
      noneNull.update(meeting.id, { ownerRef: 'x' })
    ).rejects.toThrow('different client');
    const noneUndefined = createMeetingStore({
      ...live,
      records: live.readCanonical(),
      // Runtime JavaScript can still return a missing value; the public TypeScript
      // contract deliberately exposes only sealed-pair-or-null.
      getActiveClientBoundary: () => undefined as never,
    });
    expect(noneUndefined.list).toEqual([]);
  });

  it('creates, durably links, and opens only an exactly-one-matter legacy meeting', async () => {
    seedTrustedAuthority();
    const live = canonicalPort();
    const service = createMeetingPopulationService(live);
    const linked = await service.createAndLink(draft, {
      meetingDir: LEGACY_DIR,
    });
    expect(linked.legacyLink?.meetingDir).toBe(LEGACY_DIR);

    // A fresh reader receives the real saved canonical record, not a held
    // object from the creator. The same link is idempotent and cannot replace
    // itself with another folder.
    const fresh = createMeetingPopulationService({
      ...live,
      records: live.readCanonical(),
    });
    await expect(
      fresh.linkLegacy(linked.id, { meetingDir: LEGACY_DIR })
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
    // The open target is un-forgeable: only the trusted resolver mints one.
    expect(verifyMeetingOpenTarget(target)).toBe(true);
  });

  it('fails closed for false legacy identity and cross-device availability', async () => {
    const live = canonicalPort();
    const created = await createMeetingStore(live).createDraft(draft);
    const input = { meetingDir: LEGACY_DIR };
    const svc = () =>
      createMeetingPopulationService({
        ...live,
        records: live.readCanonical(),
      });

    // Legacy meeting.json claims a different matter → refused.
    seedTrustedAuthority({ workspace: { metadataMatterId: 'matter-2' } });
    await expect(svc().linkLegacy(created.id, input)).rejects.toThrow(
      'different matter'
    );
    // The household maps to two matters (ambiguous) → no exactly-one anchor.
    seedTrustedAuthority({
      matters: [
        {
          id: 'matter-1',
          name: 'One',
          client: 'One',
          folderPaths: ['/workspace/Clients/Household One'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
        {
          id: 'matter-2',
          name: 'Two',
          client: 'Two',
          folderPaths: ['/workspace/Clients/Household Two'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    await expect(svc().linkLegacy(created.id, input)).rejects.toThrow(
      'exactly one'
    );
    // Traversal path → refused before any authority is consulted.
    seedTrustedAuthority();
    await expect(
      svc().linkLegacy(created.id, { meetingDir: '../other-client' })
    ).rejects.toThrow('normalized and traversal-free');

    const linked = await svc().linkLegacy(created.id, input);
    // Relayed to a device where the folder is gone → honest failure at open.
    seedTrustedAuthority({ workspace: { exists: false } });
    await expect(svc().openTarget(linked.id)).rejects.toThrow(
      'unavailable on this device'
    );
  });

  it('reads a firm directory only through an owner-issued sealed grant', async () => {
    seedTrustedAuthority();
    const live = canonicalPort();
    await createMeetingStore(live).createDraft(draft);
    const reader = createMeetingStoreReaderLive(live);

    // A genuine grant, minted from the trusted matter store, lists the meeting.
    const grant = grantFirmMeetingDirectoryAccess(['matter-1']);
    if (!grant) throw new Error('expected a genuine grant');
    await expect(
      createFirmMeetingDirectoryReader(reader, grant).list()
    ).resolves.toMatchObject({ kind: 'ready', meetings: [{ matterId: 'matter-1' }] });

    // A grant that names a matter outside owner truth is refused (fail closed):
    // matter-1 is the only owner-truth matter, so asking for matter-2 is null.
    expect(grantFirmMeetingDirectoryAccess(['matter-2'])).toBeNull();

    // A hand-constructed "always allowed" object is NOT in the seal → refused.
    const forgedGrant = {
      allowedMatterIds: ['matter-1'],
    } as unknown as Parameters<typeof createFirmMeetingDirectoryReader>[1];
    await expect(
      createFirmMeetingDirectoryReader(reader, forgedGrant).list()
    ).resolves.toMatchObject({ kind: 'refused', reason: 'authority-refused' });
    await expect(
      createFirmMeetingDirectoryReader(reader, forgedGrant).get('anything')
    ).resolves.toMatchObject({ kind: 'refused', reason: 'authority-refused' });
  });

  it('reads review-needed artifacts from the fresh canonical store across the sealed firm grant', async () => {
    seedTrustedAuthority({
      matters: [
        {
          id: 'matter-1',
          name: 'One',
          client: 'One',
          folderPaths: ['/workspace/Clients/One'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
        {
          id: 'matter-2',
          name: 'Two',
          client: 'Two',
          folderPaths: ['/workspace/Clients/Two'],
          crmHouseholdKeys: ['household-2'],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    const live = canonicalPort();
    const grant = grantFirmMeetingDirectoryAccess();
    if (!grant) throw new Error('expected a genuine firm grant');
    const reader = readReviewNeededMeetingArtifacts(
      createMeetingArtifactStore({
        ...live,
        getFirmSelectionError: () => null,
      }),
      grant,
      [
        { kind: 'action-update-proposal', minimumSchemaVersion: 1 },
        { kind: 'follow-up-draft', minimumSchemaVersion: 1 },
      ]
    );

    // Create the records AFTER the reader. Its answer must come from a fresh
    // canonical reload, not the empty construction-time snapshot.
    const meetingOne = await createMeetingStore(live).createDraft(draft);
    const meetingTwo = await createMeetingStore({
      ...live,
      records: live.readCanonical(),
      getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
    }).createDraft({
      ...draft,
      matterId: 'matter-2',
      householdRef: 'household-2',
      scheduledStartUtc: '2026-07-21T09:00:00.000Z',
      scheduledEndUtc: '2026-07-21T10:00:00.000Z',
    });
    let writer = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
    });
    const reviewOne = await writer.append({
      meetingId: meetingOne.id,
      kind: 'action-update-proposal',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: { summary: 'Review client one' },
    });
    const approved = await writer.append({
      meetingId: meetingOne.id,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      producedAt: '2026-07-20T10:01:00.000Z',
      approvedAt: '2026-07-20T10:02:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: { summary: 'Already reviewed' },
    });
    writer = createMeetingArtifactStore({
      ...live,
      records: live.readCanonical(),
      getActiveClientBoundary: () => sealedBoundary('household-2', 'matter-2'),
    });
    const reviewTwo = await writer.append({
      meetingId: meetingTwo.id,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      producedAt: '2026-07-21T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: { summary: 'Review client two' },
    });

    const result = await reader.list();
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error(result.message);
    expect(result.artifacts.map((artifact) => artifact.id)).toEqual([
      reviewOne.id,
      reviewTwo.id,
    ]);
    expect(result.artifacts.map((artifact) => artifact.matterId)).toEqual([
      'matter-1',
      'matter-2',
    ]);
    expect(
      result.artifacts.some((artifact) => artifact.id === approved.id)
    ).toBe(false);
    expect(
      live.commands.filter((command) => command === 'crm_live_list')
    ).not.toHaveLength(0);

    const forgedGrant = {
      allowedMatterIds: ['matter-1', 'matter-2'],
    } as unknown as Parameters<typeof readReviewNeededMeetingArtifacts>[1];
    const forgedReader = readReviewNeededMeetingArtifacts(
      createMeetingArtifactStore({
        ...live,
        records: live.readCanonical(),
        getFirmSelectionError: () => null,
      }),
      forgedGrant,
      [{ kind: 'action-update-proposal', minimumSchemaVersion: 1 }]
    );
    await expect(forgedReader.list()).resolves.toEqual({
      kind: 'refused',
      reason: 'authority-refused',
      message: 'Firm meeting artifact access was not authorized.',
    });
  });

  it('surfaces a blocked firm selection instead of returning an empty artifact list', async () => {
    seedTrustedAuthority();
    const live = canonicalPort();
    const grant = grantFirmMeetingDirectoryAccess();
    if (!grant) throw new Error('expected a genuine firm grant');
    const reader = readReviewNeededMeetingArtifacts(
      createMeetingArtifactStore({
        ...live,
        getFirmSelectionError: () =>
          'The selected client is still unresolved. Choose a valid client or matter and try again.',
      }),
      grant,
      [{ kind: 'action-update-proposal', minimumSchemaVersion: 1 }]
    );

    await expect(reader.list()).resolves.toEqual({
      kind: 'refused',
      reason: 'selection-blocked',
      message:
        'The selected client is still unresolved. Choose a valid client or matter and try again.',
    });
  });

  it('keeps a truthful empty firm distinct from the same firm becoming blocked', async () => {
    seedTrustedAuthority();
    const live = canonicalPort();
    let blocked: string | null = null;
    const grant = grantFirmMeetingDirectoryAccess();
    if (!grant) throw new Error('expected a genuine firm grant');
    const reader = readReviewNeededMeetingArtifacts(
      createMeetingArtifactStore({
        ...live,
        getFirmSelectionError: () => blocked,
      }),
      grant,
      [{ kind: 'action-update-proposal', minimumSchemaVersion: 1 }]
    );

    await expect(reader.list()).resolves.toEqual({
      kind: 'ready',
      artifacts: [],
    });
    blocked = 'The client selection is still catching up.';
    await expect(reader.list()).resolves.toEqual({
      kind: 'refused',
      reason: 'selection-blocked',
      message: 'The client selection is still catching up.',
    });
  });

  // ── Boundary probes: reach ACROSS the authority boundary and FAIL if the
  // contract trusts a caller-supplied structural object as identity. ───────────
  describe('authority-boundary probes', () => {
    it('probe: a forged MeetingOpenTarget is rejected by the seal', async () => {
      seedTrustedAuthority();
      const live = canonicalPort();
      const service = createMeetingPopulationService(live);
      const linked = await service.createAndLink(draft, {
        meetingDir: LEGACY_DIR,
      });
      const genuine = await service.openTarget(linked.id);
      expect(verifyMeetingOpenTarget(genuine)).toBe(true);

      // A consumer hand-builds an identical-looking target for ANOTHER client.
      const forged = {
        kind: 'linked-legacy-meeting',
        meeting: { ...genuine.meeting, matterId: 'matter-evil' },
        client: { householdRef: 'household-evil', matterId: 'matter-evil' },
        legacyLink: genuine.legacyLink,
        meetingDir: genuine.meetingDir,
      } as unknown as MeetingOpenTarget;
      // The seal is the only proof of authority: the forgery is not believed.
      expect(verifyMeetingOpenTarget(forged)).toBe(false);
      // Even a shallow-copied genuine target loses its seal (identity, not shape).
      expect(verifyMeetingOpenTarget({ ...genuine })).toBe(false);
    });

    it('probe: multi-matter ambiguity for one household fails closed at open', async () => {
      seedTrustedAuthority();
      const live = canonicalPort();
      const service = createMeetingPopulationService(live);
      const linked = await service.createAndLink(draft, {
        meetingDir: LEGACY_DIR,
      });
      // A second matter now also claims household-1: the exactly-one anchor is
      // gone, so opening must refuse rather than first-match matter-1.
      seedTrustedAuthority({
        matters: [
          {
            id: 'matter-1',
            name: 'One',
            client: 'One',
            folderPaths: ['/workspace/Clients/Household One'],
            crmHouseholdKeys: ['household-1'],
            createdAt: '2026-07-01T00:00:00.000Z',
          } as Matter,
          {
            id: 'matter-9',
            name: 'Nine',
            client: 'Nine',
            folderPaths: ['/workspace/Clients/Household Nine'],
            crmHouseholdKeys: ['household-1'],
            createdAt: '2026-07-01T00:00:00.000Z',
          } as Matter,
        ],
      });
      await expect(
        createMeetingPopulationService({
          ...live,
          records: live.readCanonical(),
        }).openTarget(linked.id)
      ).rejects.toThrow('exactly one');
    });

    it('probe: an ancestor symlink escaping the workspace is refused', async () => {
      const live = canonicalPort();
      const created = await createMeetingStore(live).createDraft(draft);
      // The ANCESTOR "Clients" folder is a symlink pointing OUTSIDE the
      // workspace; the final meeting folder itself is not a symlink. A check
      // that inspects only the leaf would miss this escape.
      seedTrustedAuthority({
        workspace: {
          symlinks: { Clients: '/etc/evil' },
        },
      });
      await expect(
        createMeetingPopulationService({
          ...live,
          records: live.readCanonical(),
        }).linkLegacy(created.id, { meetingDir: LEGACY_DIR })
      ).rejects.toThrow('outside the open workspace');
    });

    it('probe: a symlink with no resolver support fails closed', async () => {
      const live = canonicalPort();
      const created = await createMeetingStore(live).createDraft(draft);
      seedTrustedAuthority({
        workspace: {
          symlinks: { Clients: '/whatever' },
          resolveSymlink: false,
        },
      });
      await expect(
        createMeetingPopulationService({
          ...live,
          records: live.readCanonical(),
        }).linkLegacy(created.id, { meetingDir: LEGACY_DIR })
      ).rejects.toThrow('cannot resolve its folder safely');
    });

    it('probe: a concurrent first link cannot be silently overwritten', async () => {
      seedTrustedAuthority();
      const live = canonicalPort();
      const created = await createMeetingStore(live).createDraft(draft);

      // Model a race: AFTER this linker's no-link read but BEFORE it observes
      // its own save, a competing writer commits a DIFFERENT legacy link. The
      // post-write re-read must catch that the durable link is not ours.
      let injected = false;
      const racingPort = {
        ...live,
        records: live.readCanonical(),
        reloadRecords: () => {
          const current = live.readCanonical();
          if (!injected) {
            injected = true; // first (pre-write) read: no link yet.
            return Promise.resolve(current);
          }
          // Subsequent reads: a competitor already linked a different folder.
          return Promise.resolve(
            current.map((record) =>
              record.id === created.id
                ? {
                    ...record,
                    legacyMeetingLink: {
                      meetingDir: 'Clients/Household One/Meetings/competitor',
                      linkedAt: '2026-07-20T09:30:00.000Z',
                    },
                  }
                : record
            )
          );
        },
      };
      await expect(
        createMeetingPopulationService(racingPort).linkLegacy(created.id, {
          meetingDir: LEGACY_DIR,
        })
      ).rejects.toThrow(/concurrent legacy link|cannot replace/);
    });

    it('probe: two REAL concurrent first links — exactly one wins, the other is refused', async () => {
      seedTrustedAuthority();
      const live = canonicalPort();
      const created = await createMeetingStore(live).createDraft(draft);

      // Reproduce the exact window the post-write re-read guard alone MISSES:
      // linker A commits AND re-reads its own link (durable == A at that instant,
      // so A returns success), and only THEN does linker B commit a different
      // folder (durable becomes B). Without serialization BOTH callers report
      // success while the second silently overwrites the first. We force that
      // ordering by parking B's save until A has fully returned.
      let releaseB: () => void = () => {};
      const bMaySave = new Promise<void>((resolve) => {
        releaseB = resolve;
      });
      const gatedPort = {
        ...live,
        records: live.readCanonical(),
        reloadRecords: () => Promise.resolve(live.readCanonical()),
        save: async (record: LiveCrmRecord) => {
          const link = record['legacyMeetingLink'] as
            | { meetingDir?: string }
            | undefined;
          // Hold B (the 2026-07-21 folder) at its save until A has finished.
          if (link?.meetingDir?.includes('2026-07-21')) await bMaySave;
          return live.save(record);
        },
      };
      const service = createMeetingPopulationService(gatedPort);
      const dirA = 'Clients/Household One/Meetings/2026-07-20';
      const dirB = 'Clients/Household One/Meetings/2026-07-21';

      const aPromise = service.linkLegacy(created.id, { meetingDir: dirA });
      const bPromise = service.linkLegacy(created.id, { meetingDir: dirB });
      // A is not gated: it runs to completion (serialization or not).
      const aOutcome = await Promise.allSettled([aPromise]);
      // Now let B proceed. With the mutex, B never reached its save — it is
      // queued behind A and, on running, sees A's committed link and refuses.
      // Without the mutex, B was parked mid-flight and now overwrites A.
      releaseB();
      const bOutcome = await Promise.allSettled([bPromise]);

      const results = [...aOutcome, ...bOutcome];
      const fulfilled = results.filter(
        (
          r
        ): r is PromiseFulfilledResult<
          Awaited<ReturnType<typeof service.linkLegacy>>
        > => r.status === 'fulfilled'
      );
      // Exactly one linker wins; the other is refused. (Load-bearing: with the
      // mutex removed, B also fulfils and this length is 2.)
      expect(fulfilled).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      // The durable link is exactly the single winner's — nothing overwrote it.
      const durable = live.readCanonical().find((r) => r.id === created.id)?.[
        'legacyMeetingLink'
      ] as { meetingDir: string } | undefined;
      const winnerDir = fulfilled[0]?.value.legacyLink?.meetingDir;
      expect(winnerDir).toBeTruthy();
      expect(durable?.meetingDir).toBe(winnerDir);
    });

    it('probe: a genuine firm grant is frozen — it cannot be widened after mint', async () => {
      seedTrustedAuthority({
        matters: [
          {
            id: 'matter-1',
            name: 'One',
            client: 'One',
            folderPaths: ['/workspace/Clients/Household One'],
            crmHouseholdKeys: ['household-1'],
            createdAt: '2026-07-01T00:00:00.000Z',
          } as Matter,
          {
            id: 'matter-victim',
            name: 'Victim',
            client: 'Victim',
            folderPaths: ['/workspace/Clients/Victim'],
            crmHouseholdKeys: ['household-victim'],
            createdAt: '2026-07-01T00:00:00.000Z',
          } as Matter,
        ],
      });
      const live = canonicalPort();
      // One meeting per matter: a widened grant would leak the victim's meeting.
      await createMeetingStore(live).createDraft(draft);
      await createMeetingStore({
        ...live,
        getActiveClientBoundary: () => sealedBoundary('household-victim', 'matter-victim'),
      }).createDraft({
        ...draft,
        matterId: 'matter-victim',
        householdRef: 'household-victim',
      });
      const reader = createMeetingStoreReaderLive(live);

      const grant = grantFirmMeetingDirectoryAccess(['matter-1']);
      if (!grant) throw new Error('expected a genuine grant');
      // Sealed AND frozen: provenance proves it was minted by the trusted path,
      // the freeze proves it has not been widened since.
      expect(Object.isFrozen(grant)).toBe(true);
      expect(Object.isFrozen(grant.allowedMatterIds)).toBe(true);

      // A holder tries to push the victim matter into the sealed grant. In a
      // strict-mode module the write to the frozen array throws; either way the
      // widening must not take effect.
      expect(() => {
        (grant.allowedMatterIds as string[]).push('matter-victim');
      }).toThrow();
      expect([...grant.allowedMatterIds]).toEqual(['matter-1']);

      // The reader honours exactly matter-1 — the victim meeting never leaks.
      const listed = await createFirmMeetingDirectoryReader(
        reader,
        grant
      ).list();
      expect(listed.kind).toBe('ready');
      if (listed.kind !== 'ready') throw new Error('expected ready directory');
      expect(listed.meetings).toHaveLength(1);
      expect(listed.meetings.every((meeting) => meeting.matterId === 'matter-1')).toBe(true);
    });

    it('probe: with no open workspace, linking and opening fail closed', async () => {
      useMatterStore.setState({ matters: [] });
      setActiveWorkspaceService(null);
      const live = canonicalPort();
      const created = await createMeetingStore(live).createDraft(draft);
      await expect(
        createMeetingPopulationService({
          ...live,
          records: live.readCanonical(),
        }).linkLegacy(created.id, { meetingDir: LEGACY_DIR })
      ).rejects.toThrow('requires an open workspace');
    });
  });
});

/**
 * The firm reader takes a plain LivePort (no active-client resolver required):
 * strip the client-scope resolver from a test port so its cross-client nature
 * is explicit.
 */
function createMeetingStoreReaderLive(
  live: ReturnType<typeof canonicalPort>
): ReturnType<typeof canonicalPort> & {
  readonly getFirmSelectionError: () => string | null;
} {
  return {
    ...live,
    records: live.readCanonical(),
    getFirmSelectionError: () => null,
  };
}

function linkedStatusRecord(
  overrides: Partial<LiveCrmRecord> = {}
): LiveCrmRecord {
  return {
    id: 'meeting-linked',
    kind: 'meeting',
    matterId: 'matter-1',
    householdRef: 'household-1',
    legacyMeetingLink: {
      meetingDir: LEGACY_DIR,
      linkedAt: '2026-07-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('legacy meeting link-status doorway', () => {
  it('derives sealed linked and folder-only results from one bounded snapshot', async () => {
    seedTrustedAuthority();
    const live = canonicalPort([
      linkedStatusRecord(),
      // Similar names and dates are deliberately irrelevant without the exact
      // durable link key.
      linkedStatusRecord({
        id: 'meeting-similar',
        title: '2026-07-21 review',
        scheduledStartUtc: '2026-07-21T09:00:00.000Z',
        legacyMeetingLink: {
          meetingDir: 'Clients/Household One/Meetings/2026-07-21',
          linkedAt: '2026-07-01T00:00:00.000Z',
        },
      }),
    ]);
    const reader = createLegacyMeetingLinkStatusReader(live);
    const statuses = await reader.readMany([
      {
        meetingDir: LEGACY_DIR,
        // Extra caller claims have no contract role and are ignored at runtime.
        matterId: 'matter-victim',
        status: 'folder-only',
      } as unknown as { readonly meetingDir: string },
      { meetingDir: 'Clients/Household One/Meetings/2026-07-22' },
      { meetingDir: LEGACY_DIR },
    ]);

    expect(live.commands).toEqual(['crm_live_list']);
    expect([...statuses.keys()]).toEqual([
      LEGACY_DIR,
      'Clients/Household One/Meetings/2026-07-22',
    ]);
    const linked = statuses.get(LEGACY_DIR);
    const folderOnly = statuses.get(
      'Clients/Household One/Meetings/2026-07-22'
    );
    expect(linked).toMatchObject({
      kind: 'linked',
      meetingRef: 'meeting-linked',
    });
    expect(folderOnly).toMatchObject({ kind: 'folder-only' });
    expect(verifyLegacyMeetingLinkStatus(linked)).toBe(true);
    expect(verifyLegacyMeetingLinkStatus(folderOnly)).toBe(true);
    expect(Object.isFrozen(linked)).toBe(true);
    expect(Object.isFrozen(folderOnly)).toBe(true);
    expect(live.commands).not.toContain('crm_live_upsert');
  });

  it('rejects forged or tampered status objects', async () => {
    seedTrustedAuthority();
    const status = await createLegacyMeetingLinkStatusReader(
      canonicalPort([linkedStatusRecord()])
    ).read({ meetingDir: LEGACY_DIR });
    const forged = {
      kind: 'linked',
      meetingRef: 'meeting-linked',
    } as unknown as LegacyMeetingLinkStatus;

    expect(verifyLegacyMeetingLinkStatus(forged)).toBe(false);
    expect(verifyLegacyMeetingLinkStatus({ ...status })).toBe(false);
    expect(() => Object.assign(status, { kind: 'folder-only' })).toThrow();
    expect(status).toMatchObject({
      kind: 'linked',
      meetingRef: 'meeting-linked',
    });
  });

  it('fails closed instead of inventing folder-only when status truth is uncertain', async () => {
    seedTrustedAuthority();
    const unavailable = () =>
      createLegacyMeetingLinkStatusReader(
        canonicalPort([linkedStatusRecord()])
      );

    await expect(
      createLegacyMeetingLinkStatusReader({
        ...canonicalPort(),
        getActiveClientBoundary: () => null,
      }).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('Active client');
    await expect(
      createLegacyMeetingLinkStatusReader({
        ...canonicalPort(),
        error: 'CRM unavailable',
      }).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('unavailable');
    await expect(
      createLegacyMeetingLinkStatusReader({
        ...canonicalPort(),
        reloadRecords: () => Promise.resolve(undefined),
      }).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('status is unavailable');
    setActiveWorkspaceService(null);
    await expect(
      unavailable().read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('requires an open workspace');
    seedTrustedAuthority();
    await expect(
      unavailable().read({ meetingDir: '../escape' })
    ).rejects.toThrow('traversal-free');
    await expect(
      unavailable().read({ meetingDir: '/absolute' })
    ).rejects.toThrow('workspace-relative');
    await expect(
      createLegacyMeetingLinkStatusReader(
        canonicalPort([
          linkedStatusRecord({
            legacyMeetingLink: { meetingDir: LEGACY_DIR, linkedAt: 'bad' },
          }),
        ])
      ).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('timestamp');
    await expect(
      createLegacyMeetingLinkStatusReader(
        canonicalPort([
          linkedStatusRecord(),
          linkedStatusRecord({ id: 'meeting-duplicate' }),
        ])
      ).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('More than one');
    await expect(
      createLegacyMeetingLinkStatusReader(
        canonicalPort([linkedStatusRecord({ matterId: 'matter-victim' })])
      ).read({ meetingDir: LEGACY_DIR })
    ).rejects.toThrow('different client');
  });

  it('rejects a live client switch after its one authoritative reload', async () => {
    seedTrustedAuthority();
    let active = 'matter-1';
    const live = canonicalPort([linkedStatusRecord()]);
    const reader = createLegacyMeetingLinkStatusReader({
      ...live,
      getActiveClientBoundary: () => boundaryForMatter(active),
      reloadRecords: async () => {
        active = 'matter-2';
        return live.reloadRecords();
      },
    });
    await expect(reader.read({ meetingDir: LEGACY_DIR })).rejects.toThrow(
      'Active client changed'
    );
    expect(live.commands).toEqual(['crm_live_list']);
  });
});
