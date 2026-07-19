import '@/i18n';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  issueSharedClientSelection,
  readSelectionOperationDecision,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  briefKey,
  selectExactMeetingBrief,
  useBriefStore,
  type ExactMeetingBriefTarget,
  type MeetingBrief,
} from '../briefStore';
import {
  createFirmMeetingDirectoryReader,
  createMeetingArtifactStore,
  createMeetingStore,
  grantFirmMeetingDirectoryAccess,
  meetingArtifactsForClient,
  readActiveMeetingClientBoundary,
  type ClientScopedLivePort,
  type MeetingArtifactInput,
  type MeetingProjection,
  type SealedMeetingClientBoundary,
} from '../foundation/contract';
import {
  createMeetingAgendaStore,
  meetingAgendaTarget,
  type MeetingAgendaTarget,
} from '../agenda/meetingAgendaStore';
import {
  createMeetingFollowUpStore,
  meetingFollowUpTarget,
  type MeetingFollowUpTarget,
} from '../followUp/meetingFollowUpStore';
import { createStructuredMeetingSummaryReader } from '../structuredMeetingSummary';
import {
  createMeetingReviewInboxReader,
  MEETING_REVIEW_INBOX_REQUIREMENTS,
} from '../meetingReviewInbox';
import { meetingEntryHostIdentity } from '../meetingEntryHostIdentity';
import { ClientMeetingsTab } from '../ClientMeetingsTab';
import { MeetingsDetailHost } from './MeetingsWorkspace';

const SHARED_MATTER_ID = 'matter-shared';
const EVENT_ID = 'event-shared';
const CLIENT_A = {
  provider: 'wealthbox' as const,
  householdId: 'household-a',
  displayName: 'Alpha Household',
};
const CLIENT_B = {
  provider: 'wealthbox' as const,
  householdId: 'household-b',
  displayName: 'Beta Household',
};

const FIRM_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

async function selectClient(client: typeof CLIENT_A | typeof CLIENT_B) {
  return requestSharedClientSelection(issueSharedClientSelection(client));
}

function currentFirmSelectionError(): string | null {
  const decision = readSelectionOperationDecision(FIRM_SELECTION_REQUEST);
  return decision.kind === 'refused' ? decision.message : null;
}

function canonicalMeeting(
  id: string,
  householdRef: string,
  start: string
): LiveCrmRecord {
  return {
    id,
    kind: 'meeting',
    matterId: SHARED_MATTER_ID,
    householdRef,
    workspaceId: 'workspace-1',
    typeId: 'annual-review',
    ownerRef: 'advisor-1',
    scheduledStartUtc: start,
    scheduledEndUtc: new Date(Date.parse(start) + 3_600_000).toISOString(),
    timezone: 'UTC',
    state: 'completed',
    references: [EVENT_ID],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

function taskProposal(meetingId: string): MeetingArtifactInput {
  return {
    meetingId,
    kind: 'action-update-proposal',
    schemaVersion: 2,
    producedAt: '2026-07-18T10:01:00.000Z',
    sourceRefs: [`transcript:${meetingId}`],
    provenance: 'local-processing',
    payload: {
      proposal: {
        id: 'alpha-task-proposal',
        kind: 'task',
        title: 'Alpha private task',
        detail: 'Alpha task detail must never reach Beta.',
        ownerRef: 'advisor-1',
        dueDate: '2026-07-30',
        transcriptRef: `transcript:${meetingId}`,
      },
    },
  };
}

function crmProposal(meetingId: string): MeetingArtifactInput {
  return {
    meetingId,
    kind: 'action-update-proposal',
    schemaVersion: 2,
    producedAt: '2026-07-18T10:02:00.000Z',
    sourceRefs: [`transcript:${meetingId}`],
    provenance: 'local-processing',
    payload: {
      proposal: {
        id: 'alpha-crm-proposal',
        kind: 'crm-update',
        title: 'Alpha private CRM update',
        detail: 'Alpha CRM detail must never reach Beta.',
        transcriptRef: `transcript:${meetingId}`,
        entityRef: 'contact-alpha',
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

function exactBrief(
  boundary: SealedMeetingClientBoundary
): MeetingBrief {
  const day = '2026-07-20';
  return {
    key: briefKey({ clientBoundary: boundary, eventId: EVENT_ID, day }),
    eventId: EVENT_ID,
    householdRef: boundary.householdRef,
    matterId: boundary.matterId,
    day,
    status: 'ready',
    markdown: 'Alpha private prep brief',
    citations: [],
    generatedAt: '2026-07-18T10:00:00.000Z',
    stale: false,
    eventTitle: 'Alpha annual review',
  };
}

interface RealStoreFixture {
  readonly port: ClientScopedLivePort;
  readonly records: () => readonly LiveCrmRecord[];
  readonly boundaryA: SealedMeetingClientBoundary;
  readonly meetingA: MeetingProjection;
  readonly briefTargetA: ExactMeetingBriefTarget;
  readonly agendaTargetA: MeetingAgendaTarget;
  readonly followUpTargetA: MeetingFollowUpTarget;
  readonly summaryReaderA: ReturnType<typeof createStructuredMeetingSummaryReader>;
  readonly agendaStoreA: ReturnType<typeof createMeetingAgendaStore>;
  readonly followUpStoreA: ReturnType<typeof createMeetingFollowUpStore>;
  readonly taskCrmReaderA: ReturnType<typeof meetingArtifactsForClient>;
  readonly inbox: ReturnType<typeof createMeetingReviewInboxReader>;
}

async function realStoreFixture(): Promise<RealStoreFixture> {
  let records: LiveCrmRecord[] = [
    canonicalMeeting(
      'meeting-alpha',
      CLIENT_A.householdId,
      '2026-07-20T09:00:00.000Z'
    ),
    canonicalMeeting(
      'meeting-beta',
      CLIENT_B.householdId,
      '2026-07-20T11:00:00.000Z'
    ),
  ];
  const port: ClientScopedLivePort = {
    get records() {
      return structuredClone(records);
    },
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: readActiveMeetingClientBoundary,
    getSelectionError: () => null,
    getFirmSelectionError: currentFirmSelectionError,
    save: (record) => {
      const saved = structuredClone(record);
      records = records.some((candidate) => candidate.id === saved.id)
        ? records.map((candidate) =>
            candidate.id === saved.id ? saved : candidate
          )
        : [...records, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords: () => Promise.resolve(structuredClone(records)),
  };

  await expect(selectClient(CLIENT_A)).resolves.toMatchObject({
    kind: 'selected',
  });
  const boundaryA = readActiveMeetingClientBoundary();
  if (!boundaryA) throw new Error('Expected Alpha sealed boundary.');

  const meetingsA = createMeetingStore(port);
  const artifactsA = createMeetingArtifactStore(port);
  const meetingA = await meetingsA.get('meeting-alpha');
  if (!meetingA) throw new Error('Expected Alpha canonical meeting.');

  await artifactsA.append({
    meetingId: meetingA.id,
    kind: 'summary',
    schemaVersion: 1,
    producedAt: '2026-07-18T10:00:00.000Z',
    sourceRefs: [`transcript:${meetingA.id}`],
    provenance: 'local-processing',
    payload: {
      summary: 'Alpha private summary',
      decisions: ['Alpha private decision'],
      personalNotes: ['Alpha private note'],
    },
  });
  await artifactsA.append(taskProposal(meetingA.id));
  await artifactsA.append(crmProposal(meetingA.id));

  const followUpTargetA = meetingFollowUpTarget(meetingA, boundaryA);
  if (!followUpTargetA) throw new Error('Expected Alpha follow-up target.');
  const followUpStoreA = createMeetingFollowUpStore(meetingsA, artifactsA);
  await expect(
    followUpStoreA.save(followUpTargetA, {
      to: 'alpha@example.com',
      subject: 'Alpha private follow-up',
      body: 'Alpha private follow-up body',
      state: 'edited',
    })
  ).resolves.toMatchObject({ kind: 'ready' });

  const agendaTargetA = meetingAgendaTarget(meetingA, boundaryA);
  if (!agendaTargetA) throw new Error('Expected Alpha agenda target.');
  const agendaStoreA = createMeetingAgendaStore(port);
  const createdAgenda = await agendaStoreA.create(agendaTargetA);
  if (createdAgenda.kind !== 'ready') {
    throw new Error(`Expected Alpha agenda: ${createdAgenda.message}`);
  }
  await expect(
    agendaStoreA.save(agendaTargetA, {
      body: 'Alpha private agenda',
      expectedRevision: createdAgenda.agenda.revision,
    })
  ).resolves.toMatchObject({ kind: 'ready' });

  const brief = exactBrief(boundaryA);
  useBriefStore.setState({ briefs: { [brief.key]: brief } });
  const briefTargetA: ExactMeetingBriefTarget = {
    eventId: EVENT_ID,
    meeting: meetingA,
    clientBoundary: boundaryA,
  };
  const summaryReaderA = createStructuredMeetingSummaryReader(
    meetingsA,
    artifactsA,
    boundaryA
  );
  const taskCrmReaderA = meetingArtifactsForClient(
    meetingsA,
    artifactsA,
    boundaryA,
    [{ kind: 'action-update-proposal', minimumSchemaVersion: 2 }]
  );
  const grant = grantFirmMeetingDirectoryAccess();
  if (!grant) throw new Error('Expected real firm directory grant.');
  const inbox = createMeetingReviewInboxReader({
    directory: createFirmMeetingDirectoryReader(port, grant),
    reviews: artifactsA.reviewNeededForFirm(
      grant,
      MEETING_REVIEW_INBOX_REQUIREMENTS
    ),
    getActiveClientBoundary: readActiveMeetingClientBoundary,
    getMeetingFacts: () => [],
    now: () => '2026-07-20T12:00:00.000Z',
  });

  return {
    port,
    records: () => records,
    boundaryA,
    meetingA,
    briefTargetA,
    agendaTargetA,
    followUpTargetA,
    summaryReaderA,
    agendaStoreA,
    followUpStoreA,
    taskCrmReaderA,
    inbox,
  };
}

beforeEach(() => {
  localStorage.clear();
  setDevFlagOverride('selection-authority-boot-gate', false);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  useMatterStore.setState({
    matters: [
      {
        id: SHARED_MATTER_ID,
        name: 'Shared matter fixture',
        client: 'Two-household collision fixture',
        folderPaths: ['/workspace/Clients/Shared'],
        crmHouseholdKeys: [CLIENT_A.householdId, CLIENT_B.householdId],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
    activeMatterId: SHARED_MATTER_ID,
  });
  replaceCanonicalHouseholdDirectory('wealthbox', [CLIENT_A, CLIENT_B]);
  setDevFlagOverride('selection-authority-boot-gate', true);
  setDevFlagOverride('meetings-shell-v1', true);
});

afterEach(() => {
  setDevFlagOverride('selection-authority-boot-gate', false);
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useBriefStore.setState({ briefs: {} });
  setDevFlagOverride('meetings-shell-v1', undefined);
  setDevFlagOverride('selection-authority-boot-gate', undefined);
  localStorage.clear();
});

describe('Gate 1 — integrated-shell compile-negative proof', () => {
  it('keeps matter-only store and mount shapes outside the type boundary', () => {
    const matterOnly = { matterId: SHARED_MATTER_ID };
    const compileNegative = () => {
      // @ts-expect-error F11 requires an F8-minted target, not a matter id.
      void meetingEntryHostIdentity({ activeClientBoundary: matterOnly });
      void createElement(MeetingsDetailHost, {
        // @ts-expect-error the shell detail host cannot mount from matter-only authority.
        target: matterOnly,
        runtime: {
          workspace: { rootPath: null, serviceRef: { current: null } },
        },
        onBack: () => undefined,
      });
      void createElement(ClientMeetingsTab, {
        // @ts-expect-error every client-tab mount requires a complete sealed pair.
        clientBoundary: matterOnly,
        getActiveClientBoundary: () => null,
        matterFolder: '/workspace/Clients/Shared',
        workspaceService: null,
      });
    };
    expect(compileNegative).toBeTypeOf('function');
  });
});

describe('Gate 3 — every real panel reader fails closed after Alpha → Beta', () => {
  it('independently refuses Alpha prep, summary, agenda, Tasks/CRM, Follow-up, and Actions reads', async () => {
    const fixture = await realStoreFixture();
    expect(
      selectExactMeetingBrief(
        useBriefStore.getState().briefs,
        fixture.briefTargetA
      )?.markdown
    ).toBe('Alpha private prep brief');

    await expect(selectClient(CLIENT_B)).resolves.toMatchObject({
      kind: 'selected',
    });
    const boundaryB = readActiveMeetingClientBoundary();
    expect(boundaryB).toMatchObject({
      householdRef: CLIENT_B.householdId,
      matterId: SHARED_MATTER_ID,
    });

    expect(
      selectExactMeetingBrief(
        useBriefStore.getState().briefs,
        fixture.briefTargetA
      ),
      'Prep brief store returned Alpha after Beta became active.'
    ).toBeNull();
    await expect(fixture.summaryReaderA.read(fixture.meetingA)).resolves.toEqual({
      kind: 'empty',
    });
    await expect(
      fixture.agendaStoreA.read(fixture.agendaTargetA)
    ).resolves.toMatchObject({ kind: 'error', reason: 'identity-refused' });
    expect(
      fixture.taskCrmReaderA.listForMeeting(fixture.meetingA.id, [
        'action-update-proposal',
      ])
    ).toEqual([]);
    await expect(
      fixture.followUpStoreA.read(fixture.followUpTargetA)
    ).resolves.toEqual({ kind: 'refused' });

    const actions = await fixture.inbox.readForClient(fixture.boundaryA);
    expect(
      actions,
      'Actions/F9 returned Alpha rows after Beta became active.'
    ).toMatchObject({ kind: 'ready-empty', items: [], badgeMeetingCount: 0 });
  });
});
