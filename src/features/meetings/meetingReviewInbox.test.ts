import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  createFirmMeetingDirectoryReader,
  createMeetingArtifactStore,
  createMeetingStore,
  grantFirmMeetingDirectoryAccess,
  type MeetingArtifactInput,
  type MeetingOwnerProjection,
  type MeetingSurfaceFacts,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import { readReviewNeededMeetingArtifacts } from './reviewArtifacts';
import {
  createMeetingReviewInboxReader,
  MEETING_REVIEW_INBOX_REQUIREMENTS,
  verifyMeetingReviewInboxReadyResult,
  type MeetingReviewInboxFilter,
} from './meetingReviewInbox';

const matterId = 'matter-shared';
const clientA = sealedClient('household-a', 'Alpha Household');
const clientB = sealedClient('household-b', 'Beta Household');

function sealedClient(
  householdRef: string,
  displayName: string
): SealedMeetingClientBoundary {
  return {
    householdRef,
    matterId,
    displayName,
  } as SealedMeetingClientBoundary;
}

function canonicalPort() {
  let active = clientA;
  let records: LiveCrmRecord[] = [];
  let firmSelectionError: string | null = null;
  let reloadError = false;
  return {
    get records() {
      return structuredClone(records);
    },
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => active,
    getSelectionError: () => null,
    getFirmSelectionError: () => firmSelectionError,
    save(record: LiveCrmRecord) {
      const saved = structuredClone(record);
      records = records.some((candidate) => candidate.id === saved.id)
        ? records.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...records, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords() {
      return reloadError
        ? Promise.reject(new Error('reload failed'))
        : Promise.resolve(structuredClone(records));
    },
    setActive(client: SealedMeetingClientBoundary) {
      active = client;
    },
    blockFirm(message: string | null) {
      firmSelectionError = message;
    },
    failReload(value: boolean) {
      reloadError = value;
    },
  };
}

function meetingDraft(client: SealedMeetingClientBoundary, ownerRef: string) {
  return {
    workspaceId: 'workspace-1',
    householdRef: client.householdRef,
    matterId: client.matterId,
    typeId: 'annual-review',
    ownerRef,
    scheduledStartUtc: '2026-07-19T09:00:00.000Z',
    scheduledEndUtc: '2026-07-19T10:00:00.000Z',
    timezone: 'America/Denver',
  };
}

function taskArtifact(
  meetingId: string,
  overrides: Partial<MeetingArtifactInput> & {
    proposalId: string;
    ownerRef?: string | null;
    urgent?: boolean;
  }
): MeetingArtifactInput {
  return {
    meetingId,
    kind: 'action-update-proposal',
    schemaVersion: 2,
    producedAt: overrides.producedAt ?? '2026-07-19T11:00:00.000Z',
    sourceRefs: [],
    provenance: 'local-processing',
    payload: {
      proposal: {
        id: overrides.proposalId,
        kind: 'task',
        title: `Task ${overrides.proposalId}`,
        detail: 'Review this task.',
        ownerRef: overrides.ownerRef ?? null,
        dueDate: null,
        transcriptRef: 'transcript:1',
      },
      ...(overrides.urgent ? { urgent: true } : {}),
    },
  };
}

function crmArtifact(
  meetingId: string,
  proposalId: string,
  producedAt: string
): MeetingArtifactInput {
  return {
    meetingId,
    kind: 'action-update-proposal',
    schemaVersion: 2,
    producedAt,
    sourceRefs: [],
    provenance: 'local-processing',
    payload: {
      proposal: {
        id: proposalId,
        kind: 'crm-update',
        title: 'Update risk tolerance',
        detail: 'Confirm the proposed change.',
        transcriptRef: 'transcript:2',
        entityRef: 'contact-1',
        fields: [
          {
            field: 'riskTolerance',
            label: 'Risk tolerance',
            valueType: 'text',
            before: 'Moderate',
            proposed: 'Conservative',
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  useMatterStore.setState({
    matters: [
      {
        id: matterId,
        name: 'Shared matter fixture',
        client: 'Shared matter fixture',
        folderPaths: ['/workspace/Clients/Shared'],
        crmHouseholdKeys: [clientA.householdRef, clientB.householdRef],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
  });
});

async function fixture() {
  const port = canonicalPort();
  const meetingA = await createMeetingStore(port).createDraft(
    meetingDraft(clientA, 'owner-a')
  );
  port.setActive(clientB);
  const meetingB = await createMeetingStore(port).createDraft(
    meetingDraft(clientB, 'owner-b')
  );

  port.setActive(clientA);
  let artifacts = createMeetingArtifactStore(port);
  const taskA = await artifacts.append(
    taskArtifact(meetingA.id, {
      proposalId: 'task-a',
      ownerRef: 'owner-task',
      producedAt: '2026-07-19T11:00:00.000Z',
    })
  );
  const crmA = await artifacts.append(
    crmArtifact(meetingA.id, 'crm-a', '2026-07-19T12:00:00.000Z')
  );
  port.setActive(clientB);
  artifacts = createMeetingArtifactStore(port);
  const taskB = await artifacts.append(
    taskArtifact(meetingB.id, {
      proposalId: 'task-b',
      urgent: true,
      producedAt: '2026-07-19T10:00:00.000Z',
    })
  );

  const grant = grantFirmMeetingDirectoryAccess();
  if (!grant) throw new Error('expected firm grant');
  const reviews = readReviewNeededMeetingArtifacts(
    createMeetingArtifactStore(port),
    grant,
    MEETING_REVIEW_INBOX_REQUIREMENTS
  );
  const facts: MeetingSurfaceFacts[] = [
    {
      meetingId: meetingA.id,
      householdRef: clientA.householdRef,
      matterId,
      title: 'Alpha annual review',
      clientLabel: 'Alpha Household',
    },
    {
      meetingId: meetingB.id,
      householdRef: clientB.householdRef,
      matterId,
      title: 'Beta annual review',
      clientLabel: 'Beta Household',
    },
  ];
  const owners: MeetingOwnerProjection[] = [
    { id: 'owner-a', label: 'Advisor Alpha' },
    { id: 'owner-b', label: 'Advisor Beta' },
    { id: 'owner-task', label: 'Task Owner' },
  ];
  const inbox = createMeetingReviewInboxReader({
    directory: createFirmMeetingDirectoryReader(port, grant),
    reviews,
    getMeetingFacts: () => facts,
    getOwners: () => owners,
    now: () => '2026-07-20T00:00:00.000Z',
  });
  return {
    port,
    grant,
    inbox,
    reviews,
    meetingA,
    meetingB,
    taskA,
    crmA,
    taskB,
  };
}

describe('meeting Actions inbox', () => {
  it('requires the sealed pair and keeps the firm grant typed separately', async () => {
    const { inbox } = await fixture();
    const result = await inbox.readForClient(clientB);
    expect(result.kind).toBe('ready-populated');
  });

  it('refuses malformed selected-client pairs without exposing firm rows or badges', async () => {
    const { inbox } = await fixture();
    const refused = {
      kind: 'refused',
      reason: 'invalid-client-pair',
      message: 'A complete client selection is required.',
      retry: 'not-available',
    } as const;

    await expect(
      inbox.readForClient(undefined as unknown as SealedMeetingClientBoundary)
    ).resolves.toEqual(refused);
    await expect(
      inbox.readForClient({ matterId: 'm' } as SealedMeetingClientBoundary)
    ).resolves.toEqual(refused);
  });

  it('isolates rows and unique-meeting badges by household plus matter', async () => {
    const { inbox, meetingA, meetingB } = await fixture();
    const firm = await inbox.read();
    expect(firm.kind).toBe('ready-populated');
    if (firm.kind !== 'ready-populated') throw new Error(firm.kind);
    expect(firm.items).toHaveLength(3);
    expect(firm.badgeMeetingCount).toBe(2);
    expect(verifyMeetingReviewInboxReadyResult(firm)).toBe(true);
    expect(
      verifyMeetingReviewInboxReadyResult({
        ...firm,
        items: [...firm.items],
      })
    ).toBe(false);
    expect(firm.items[0]).toMatchObject({
      meetingId: meetingB.id,
      urgency: 'urgent',
      meetingLabel: 'Beta annual review',
      clientLabel: 'Beta Household',
      owner: { ref: null, source: 'proposal' },
    });

    const beta = await inbox.readForClient(clientB);
    expect(beta.kind).toBe('ready-populated');
    if (beta.kind !== 'ready-populated') throw new Error(beta.kind);
    expect(beta.items.map((item) => item.meetingId)).toEqual([meetingB.id]);
    expect(beta.items.some((item) => item.meetingId === meetingA.id)).toBe(
      false
    );
    expect(beta.badgeMeetingCount).toBe(1);

    const alpha = await inbox.readForClient(clientA);
    expect(alpha.kind).toBe('ready-populated');
    if (alpha.kind !== 'ready-populated') throw new Error(alpha.kind);
    expect(alpha.items).toHaveLength(2);
    expect(alpha.badgeMeetingCount).toBe(1);
  });

  it('persists archive and restore lifecycle without leaking across the pair', async () => {
    const { inbox, taskA, meetingA, meetingB } = await fixture();
    await expect(
      inbox.transitionArchive(
        taskA.id,
        { kind: 'selected-client', client: clientB },
        {
          from: 'active',
          to: 'archived',
          at: '2026-07-20T01:00:00.000Z',
        }
      )
    ).resolves.toMatchObject({ kind: 'refused', reason: 'client-mismatch' });

    await expect(
      inbox.transitionArchive(
        taskA.id,
        { kind: 'selected-client', client: clientA },
        {
          from: 'active',
          to: 'archived',
          at: '2026-07-20T01:00:00.000Z',
        }
      )
    ).resolves.toMatchObject({
      kind: 'ready',
      artifact: { reviewArchiveState: 'archived' },
    });

    const betaArchived = await inbox.readForClient(clientB, {
      view: 'archived',
      type: 'all',
      owner: { kind: 'all' },
    });
    expect(betaArchived.kind).toBe('ready-empty');
    if (betaArchived.kind !== 'ready-empty') throw new Error(betaArchived.kind);
    expect(betaArchived.badgeMeetingCount).toBe(1);

    const alphaArchived = await inbox.readForClient(clientA, {
      view: 'archived',
      type: 'all',
      owner: { kind: 'all' },
    });
    expect(alphaArchived.kind).toBe('ready-populated');
    if (alphaArchived.kind !== 'ready-populated')
      throw new Error(alphaArchived.kind);
    expect(alphaArchived.items.map((item) => item.meetingId)).toEqual([
      meetingA.id,
    ]);
    expect(
      alphaArchived.items.some((item) => item.meetingId === meetingB.id)
    ).toBe(false);
    // Alpha's other active item still keeps the unique-meeting badge at one.
    expect(alphaArchived.badgeMeetingCount).toBe(1);

    await expect(
      inbox.transitionArchive(
        taskA.id,
        { kind: 'selected-client', client: clientA },
        {
          from: 'archived',
          to: 'active',
          at: '2026-07-20T02:00:00.000Z',
        }
      )
    ).resolves.toMatchObject({
      kind: 'ready',
      artifact: { reviewArchiveState: 'active' },
    });
  });

  it('reports invalid lifecycle history as an error instead of false emptiness', async () => {
    const { inbox, port, taskA } = await fixture();
    await port.save({
      id: 'invalid-review-transition',
      kind: 'meeting_artifact_review_archive_transition',
      matterId,
      householdRef: clientA.householdRef,
      createdAt: '2026-07-20T01:00:00.000Z',
      updatedAt: '2026-07-20T01:00:00.000Z',
      artifactId: taskA.id,
      fromState: 'archived',
      toState: 'active',
      transitionAt: '2026-07-20T01:00:00.000Z',
    });

    await expect(inbox.readForClient(clientA)).resolves.toEqual({
      kind: 'error',
      message: 'Meeting review records could not be loaded.',
      retry: 'available',
    });
  });

  it('applies attention/all/archive, type, and owner filters after pair scope', async () => {
    const { inbox } = await fixture();
    const filter: MeetingReviewInboxFilter = {
      view: 'all',
      type: 'task-proposal',
      owner: { kind: 'owner', ownerRef: 'owner-task' },
    };
    const alpha = await inbox.readForClient(clientA, filter);
    expect(alpha.kind).toBe('ready-populated');
    if (alpha.kind !== 'ready-populated') throw new Error(alpha.kind);
    expect(alpha.items).toHaveLength(1);
    expect(alpha.items[0]).toMatchObject({
      kind: 'task-proposal',
      owner: { ref: 'owner-task', label: 'Task Owner', source: 'proposal' },
    });

    const beta = await inbox.readForClient(clientB, filter);
    expect(beta.kind).toBe('ready-empty');
    if (beta.kind !== 'ready-empty') throw new Error(beta.kind);
    expect(beta.emptyCopy).toContain('Beta Household');
    expect(beta.emptyCopy).toContain('filtered');
  });

  it('includes typed follow-up and explicit speaker work but no fabricated attendee row', async () => {
    const { inbox, port, meetingB } = await fixture();
    port.setActive(clientB);
    const artifacts = createMeetingArtifactStore(port);
    await artifacts.append({
      meetingId: meetingB.id,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      producedAt: '2026-07-19T13:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {
        recapKey: 'recap-beta',
        to: 'client@example.com',
        subject: 'Annual review follow-up',
        body: 'Thank you for meeting with us.',
        deliveryState: 'edited',
      },
    });
    await artifacts.append({
      meetingId: meetingB.id,
      kind: 'follow-up-draft',
      schemaVersion: 1,
      producedAt: '2026-07-19T14:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: {
        recapKey: 'already-saved',
        to: 'client@example.com',
        subject: 'Already saved',
        body: 'This is already in Outlook Drafts.',
        deliveryState: 'saved-to-drafts',
        outlookDraftId: 'draft-1',
      },
    });
    await artifacts.append({
      meetingId: meetingB.id,
      kind: 'diarization',
      schemaVersion: 1,
      producedAt: '2026-07-19T15:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: {
        reviewRequired: false,
        reviewKind: 'unmatched-attendee',
        reviewLabel: 'Calendar guest',
      },
    });
    await artifacts.append({
      meetingId: meetingB.id,
      kind: 'diarization',
      schemaVersion: 1,
      producedAt: '2026-07-19T16:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: {
        reviewRequired: true,
        reviewKind: 'unmatched-attendee',
        reviewLabel: 'Calendar guest needs a client match',
      },
    });

    const result = await inbox.readForClient(clientB, {
      view: 'all',
      type: 'all',
      owner: { kind: 'all' },
    });
    expect(result.kind).toBe('ready-populated');
    if (result.kind !== 'ready-populated') throw new Error(result.kind);
    expect(result.items.map((item) => item.kind)).toEqual([
      'task-proposal',
      'unmatched-attendee',
      'follow-up-draft',
    ]);
    const followUp = result.items.find(
      (item) => item.kind === 'follow-up-draft'
    );
    expect(followUp).toMatchObject({
      kind: 'follow-up-draft',
      draft: { state: 'edited', subject: 'Annual review follow-up' },
    });
  });

  it('exposes refused and retryable error as distinct non-empty states', async () => {
    const { inbox, port } = await fixture();
    port.blockFirm('Firm selection is still resolving.');
    await expect(inbox.read()).resolves.toEqual({
      kind: 'refused',
      reason: 'selection-blocked',
      message: 'Firm selection is still resolving.',
      retry: 'not-available',
    });
    port.blockFirm(null);
    port.failReload(true);
    await expect(inbox.read()).resolves.toEqual({
      kind: 'error',
      message: 'Meeting review records could not be loaded.',
      retry: 'available',
    });
  });
});
