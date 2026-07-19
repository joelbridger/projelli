import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  createDirectClientMeetingsAdapter,
  createFirmMeetingDirectoryReader,
  createMeetingArtifactStore,
  createMeetingStore,
  grantFirmMeetingDirectoryAccess,
  projectMeetingList,
  projectMeetingSurface,
  verifyDirectClientMeetingTarget,
  type FirmMeetingDirectoryReadResult,
  type MeetingArtifact,
  type MeetingProjection,
  type SealedMeetingClientBoundary,
} from './contract';

const clientA = {
  householdRef: 'household-a',
  matterId: 'matter-shared',
  displayName: 'Alpha Household',
} as SealedMeetingClientBoundary;
const clientB = {
  householdRef: 'household-b',
  matterId: 'matter-shared',
  displayName: 'Beta Household',
} as SealedMeetingClientBoundary;
const clientFolder = '/workspace/Clients/Alpha';

function meetingRecord(
  overrides: Partial<LiveCrmRecord> = {}
): LiveCrmRecord {
  return {
    id: 'meeting-a',
    kind: 'meeting',
    matterId: clientA.matterId,
    householdRef: clientA.householdRef,
    workspaceId: 'workspace-a',
    typeId: 'review',
    ownerRef: 'advisor-a',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'completed',
    references: [],
    createdAt: '2026-07-19T09:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides,
  };
}

function seedMatter(): void {
  useMatterStore.setState({
    matters: [
      {
        id: clientA.matterId,
        name: 'Shared matter',
        client: 'Alpha Household',
        folderPaths: [clientFolder],
        crmHouseholdKeys: [clientA.householdRef],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
  });
}

afterEach(() => {
  useMatterStore.setState({ matters: [] });
  vi.restoreAllMocks();
});

describe('F8 sealed-pair store chokepoint', () => {
  it('makes the old matter-only store and artifact-store shapes fail typechecking', () => {
    const live = {
      records: [] as LiveCrmRecord[],
      workspaceRoot: '/workspace',
      error: null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve([] as LiveCrmRecord[]),
    };
    const compileMatterOnlyShapes = () => {
      // @ts-expect-error matter-only authority is no longer a construction shape.
      void createMeetingStore({ ...live, getActiveMatterId: () => 'matter-shared' });
      // @ts-expect-error artifact access requires the same live sealed pair.
      void createMeetingArtifactStore({ ...live, getActiveMatterId: () => 'matter-shared' });
      void createMeetingStore({
        ...live,
        // @ts-expect-error even the new resolver cannot return a matter-only object.
        getActiveClientBoundary: () => ({ matterId: 'matter-shared' }),
      });
      void createDirectClientMeetingsAdapter({
        // @ts-expect-error a folder adapter cannot be built from matter alone.
        client: { matterId: 'matter-shared' },
        getActiveClientBoundary: () => null,
        matterFolder: clientFolder,
        scan: () => Promise.resolve({ meetings: [], scanFailed: false }),
      });
      // @ts-expect-error raw rows cannot claim firm-wide authority; use the sealed directory projector.
      void projectMeetingList([], { kind: 'firm' });
    };
    expect(compileMatterOnlyShapes).toBeTypeOf('function');
  });

  it('refuses direct-client rows and targets after a same-matter household switch', async () => {
    seedMatter();
    let active = clientA;
    const adapter = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => active,
      matterFolder: clientFolder,
      scan: () => {
        active = clientB;
        return Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        });
      },
    });

    const switched = await adapter.list();
    expect(switched.kind).toBe('refused');
    if (switched.kind !== 'refused') throw new Error('expected refusal');
    expect(switched.message).toContain('changed');

    active = clientA;
    const stable = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => active,
      matterFolder: clientFolder,
      scan: () =>
        Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        }),
    });
    const result = await stable.list();
    const target = stable.resolveTarget(result, {
      dir: `${clientFolder}/Meetings/meeting-a`,
      folderName: 'meeting-a',
    });
    expect(verifyDirectClientMeetingTarget(target, clientA)).toBe(true);
    expect(verifyDirectClientMeetingTarget(target, clientB)).toBe(false);
  });

  it("refuses a ready result minted by another client's adapter", async () => {
    seedMatter();
    const adapterA = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => clientA,
      matterFolder: clientFolder,
      scan: () =>
        Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        }),
    });
    const readyFromA = await adapterA.list();

    useMatterStore.setState((state) => ({
      matters: state.matters.map((matter) => ({
        ...matter,
        crmHouseholdKeys: [clientA.householdRef, clientB.householdRef],
      })),
    }));
    const adapterB = createDirectClientMeetingsAdapter<{
      readonly dir: string;
      readonly folderName: string;
    }>({
      client: clientB,
      getActiveClientBoundary: () => clientB,
      matterFolder: clientFolder,
      scan: () => Promise.resolve({ meetings: [], scanFailed: false }),
    });

    expect(
      adapterB.resolveTarget(readyFromA, {
        dir: `${clientFolder}/Meetings/meeting-a`,
        folderName: 'meeting-a',
      })
    ).toBeNull();
  });

  it('keeps firm ready/refused/error distinct and rechecks the firm gate after reload', async () => {
    seedMatter();
    const grant = grantFirmMeetingDirectoryAccess();
    if (!grant) throw new Error('expected firm grant');
    let selectionError: string | null = null;
    const port = {
      records: [] as LiveCrmRecord[],
      workspaceRoot: '/workspace',
      error: null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      getFirmSelectionError: () => selectionError,
      reloadRecords: () => Promise.resolve([meetingRecord()]),
    };
    await expect(
      createFirmMeetingDirectoryReader(port, grant).list()
    ).resolves.toMatchObject({ kind: 'ready', meetings: [{ id: 'meeting-a' }] });

    await expect(
      createFirmMeetingDirectoryReader(
        { ...port, reloadRecords: () => Promise.reject(new Error('offline')) },
        grant
      ).list()
    ).resolves.toEqual({
      kind: 'error',
      message: 'Meeting records are unavailable until they reload.',
    });

    selectionError = null;
    await expect(
      createFirmMeetingDirectoryReader(
        {
          ...port,
          reloadRecords: () => {
            selectionError = 'Firm access changed.';
            return Promise.resolve([meetingRecord()]);
          },
        },
        grant
      ).list()
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'selection-blocked',
      message: 'Firm access changed.',
    });

    selectionError = null;
    seedMatter();
    await expect(
      createFirmMeetingDirectoryReader(
        {
          ...port,
          reloadRecords: () => {
            useMatterStore.setState({ matters: [] });
            return Promise.resolve([meetingRecord()]);
          },
        },
        grant
      ).list()
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'authority-refused',
      message: 'Firm meeting directory access was not authorized.',
    });
  });

  it('joins row facts only on the exact pair and reports only proven readiness/output', () => {
    const meeting = {
      id: 'meeting-a',
      workspaceId: 'workspace-a',
      householdRef: clientA.householdRef,
      matterId: clientA.matterId,
      typeId: 'review',
      ownerRef: 'advisor-a',
      scheduledStartUtc: '2026-07-20T09:00:00.000Z',
      scheduledEndUtc: '2026-07-20T10:00:00.000Z',
      timezone: 'America/Chicago',
      state: 'completed',
      references: [],
    } satisfies MeetingProjection;
    const wrongPair = projectMeetingSurface(
      { kind: 'selected-client', client: clientA, meetings: [meeting] },
      [
        {
          meetingId: meeting.id,
          householdRef: clientB.householdRef,
          matterId: clientB.matterId,
          title: 'Wrong household title',
          platform: 'zoom',
          joinUrl: 'https://zoom.example/wrong',
          recordingStatus: 'available',
          processingStatus: 'complete',
        },
      ],
      '2026-07-20T11:00:00.000Z'
    );
    expect(wrongPair).toMatchObject({
      kind: 'ready',
      past: [
        {
          title: 'review',
          platform: 'unknown',
          joinReadiness: 'unavailable',
          recordingStatus: 'unavailable',
          processingStatus: 'unknown',
          outputs: {
            transcript: false,
            summary: false,
            tasks: false,
            followUp: false,
          },
        },
      ],
    });

    const summary = {
      id: 'artifact-summary',
      meetingId: meeting.id,
      householdRef: clientA.householdRef,
      matterId: clientA.matterId,
      kind: 'summary',
      schemaVersion: 1,
      state: 'produced',
      producedAt: '2026-07-20T10:05:00.000Z',
      sourceRefs: [],
      provenance: 'local-processing',
      payload: {},
      createdAt: '2026-07-20T10:05:00.000Z',
    } satisfies MeetingArtifact;
    const joined = projectMeetingSurface(
      { kind: 'selected-client', client: clientA, meetings: [meeting] },
      [
        {
          meetingId: meeting.id,
          householdRef: clientA.householdRef,
          matterId: clientA.matterId,
          title: 'Annual plan review',
          platform: 'teams',
          joinUrl: 'https://teams.example/meeting',
          participants: [{ name: 'Alex' }, { email: 'sam@example.com' }],
          briefStatus: 'available',
          recordingStatus: 'processing',
          processingStatus: 'needs-review',
          artifacts: [summary],
        },
      ],
      '2026-07-20T11:00:00.000Z'
    );
    expect(joined).toMatchObject({
      kind: 'ready',
      past: [
        {
          title: 'Annual plan review',
          platform: 'teams',
          participantCue: { count: 2, names: ['Alex'] },
          briefStatus: 'available',
          joinReadiness: 'available',
          recordingStatus: 'processing',
          processingStatus: 'needs-review',
          outputs: { summary: true, transcript: false },
        },
      ],
      pastFilters: {
        statuses: ['needs-review', 'processing', 'complete'],
        typeIds: ['review'],
      },
    });
    expect(joined.kind).toBe('ready');
    if (joined.kind !== 'ready') throw new Error('expected ready projection');
    expect(joined.emptyCopy.past).toContain('Alpha Household');
  });

  it('rejects an unsealed whole-firm ready result at the projector', () => {
    const forged = {
      kind: 'ready',
      meetings: [],
    } as unknown as FirmMeetingDirectoryReadResult;
    expect(
      projectMeetingSurface(
        { kind: 'whole-firm', directory: forged },
        [],
        '2026-07-20T11:00:00.000Z'
      )
    ).toEqual({
      kind: 'refused',
      message: 'Firm meeting directory access was not authorized.',
    });
  });
});
