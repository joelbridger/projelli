import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type {
  ActiveClientMeetingDraft,
  LegacyMeetingLinkInput,
  MeetingLifecycleTransition,
  MeetingPopulationService,
  MeetingRecord,
} from '@/features/meetings';
import { useBriefStore } from '@/features/meetings';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  decideMeetingFileVisibility,
  FILE_MEETING_OWNER_PRIVATE_POLICY,
} from '@/features/meetings/meetingFileVisibility';
import type { Matter } from '@/platform/types/matter';
import {
  SAMPLE_GOLDEN_PATH,
  ensureSampleHendricksCrmLink,
  seedSampleGoldenPath,
} from './seedSampleGoldenPath';

class InMemoryWorkspace {
  readonly textFiles = new Map<string, string>();
  readonly binaryFiles = new Map<string, ArrayBuffer>();

  async writeFile(path: string, content: string): Promise<void> {
    this.textFiles.set(path, content);
  }

  async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.binaryFiles.set(path, content);
  }

  async readFile(path: string): Promise<string> {
    const value = this.textFiles.get(path);
    if (value === undefined) throw new Error(`Missing ${path}`);
    return value;
  }
}

const matterId = 'matter-hendricks';
const workspaceRoot = '/temporary-hendricks-workspace';
const sampleBoundary = {
  householdRef: SAMPLE_GOLDEN_PATH.crmHouseholdKey,
  matterId,
  selectionGeneration: 1,
} as never;

function samplePopulation(): MeetingPopulationService {
  const records: MeetingRecord[] = [];
  const canonical = (draft: ActiveClientMeetingDraft): MeetingRecord => ({
    id: 'canonical-hendricks-meeting',
    kind: 'meeting',
    workspaceId: draft.workspaceId,
    householdRef: SAMPLE_GOLDEN_PATH.crmHouseholdKey,
    matterId,
    typeId: draft.typeId,
    ownerRef: draft.ownerRef,
    scheduledStartUtc: draft.scheduledStartUtc,
    scheduledEndUtc: draft.scheduledEndUtc,
    timezone: draft.timezone,
    references: draft.references ?? [],
    state: 'draft',
    createdAt: SAMPLE_GOLDEN_PATH.startedAt,
    updatedAt: SAMPLE_GOLDEN_PATH.startedAt,
  });
  return {
    createNew: async () => { throw new Error('Sample must derive its client boundary.'); },
    createAndLink: async () => { throw new Error('Sample must not supply a client boundary.'); },
    createAndLinkForActiveClient: async (draft, legacy) => {
      const meeting = { ...canonical(draft), legacyLink: { ...legacy, linkedAt: SAMPLE_GOLDEN_PATH.startedAt } };
      records.push(meeting);
      return meeting;
    },
    createForActiveClient: async (draft) => {
      const meeting = canonical(draft);
      records.push(meeting);
      return meeting;
    },
    findByReference: async (reference) =>
      records.find((meeting) => meeting.references.includes(reference)),
    transition: async (id, transition: MeetingLifecycleTransition) => {
      const index = records.findIndex((meeting) => meeting.id === id);
      const current = records[index];
      if (!current || current.state !== transition.from) throw new Error('Illegal sample transition.');
      const next = { ...current, state: transition.to, updatedAt: transition.at };
      records[index] = next;
      return next;
    },
    linkLegacy: async (id, legacy: LegacyMeetingLinkInput) => {
      const index = records.findIndex((meeting) => meeting.id === id);
      const current = records[index];
      if (!current) throw new Error('Missing canonical sample meeting.');
      const next = { ...current, legacyLink: { ...legacy, linkedAt: current.createdAt } };
      records[index] = next;
      return next;
    },
    openTarget: async () => { throw new Error('Not needed.'); },
    captureActiveClientOperationForBoundary: () => ({
      assertStable: () => undefined,
      createForActiveClient: async (draft) => {
        const meeting = canonical(draft);
        records.push(meeting);
        return meeting;
      },
      findByReference: async (reference) =>
        records.find((meeting) => meeting.references.includes(reference)),
      transition: async (id, transition: MeetingLifecycleTransition) => {
        const index = records.findIndex((meeting) => meeting.id === id);
        const current = records[index];
        if (!current || current.state !== transition.from) throw new Error('Illegal sample transition.');
        const next = { ...current, state: transition.to, updatedAt: transition.at };
        records[index] = next;
        return next;
      },
      linkLegacy: async (id, legacy: LegacyMeetingLinkInput) => {
        const index = records.findIndex((meeting) => meeting.id === id);
        const current = records[index];
        if (!current) throw new Error('Missing canonical sample meeting.');
        const next = { ...current, legacyLink: { ...legacy, linkedAt: current.createdAt } };
        records[index] = next;
        return next;
      },
    }),
  };
}

beforeEach(() => {
  useBriefStore.setState({ briefs: {} });
  useCrmWriteQueueStore.setState({ items: [] });
  useMatterStore.setState({
    matters: [
      {
        id: matterId,
        name: 'Hendricks Household',
        client: 'Hendricks Household',
        folderPaths: [`${workspaceRoot}/Hendricks Household`],
        createdAt: '2026-07-01T00:00:00.000Z',
      } satisfies Matter,
    ],
    activeMatterId: matterId,
  });
});

describe('seedSampleGoldenPath', () => {
  it('uses one canonical Hendricks meeting across the sample proof', async () => {
    const workspace = new InMemoryWorkspace();
    const population = samplePopulation();
    ensureSampleHendricksCrmLink(matterId);

    await seedSampleGoldenPath(
      workspace as unknown as WorkspaceService,
      workspaceRoot,
      matterId,
      population,
      sampleBoundary
    );
    // Re-running onboarding must update the same sample artifacts, not add a
    // second CRM item awaiting advisor approval.
    await seedSampleGoldenPath(
      workspace as unknown as WorkspaceService,
      workspaceRoot,
      matterId,
      population,
      sampleBoundary
    );

    const meetingPath = `${workspaceRoot}/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}`;
    const meeting = JSON.parse(
      workspace.textFiles.get(`${meetingPath}/meeting.json`) ?? ''
    );
    const transcript = JSON.parse(
      workspace.textFiles.get(`${meetingPath}/transcript.json`) ?? ''
    );
    const briefs = Object.values(useBriefStore.getState().briefs);
    const proposals = useCrmWriteQueueStore.getState().items;

    expect(meeting).toMatchObject({
      matterId,
      startedAt: SAMPLE_GOLDEN_PATH.startedAt,
      calendarTitle: SAMPLE_GOLDEN_PATH.eventTitle,
      customTitle: SAMPLE_GOLDEN_PATH.eventTitle,
      calendarEvent: {
        id: SAMPLE_GOLDEN_PATH.eventId,
        title: SAMPLE_GOLDEN_PATH.eventTitle,
        startUtc: SAMPLE_GOLDEN_PATH.startedAt,
        endUtc: SAMPLE_GOLDEN_PATH.endedAt,
      },
    });
    expect(transcript.meta).toMatchObject({
      matterId,
      startedAt: SAMPLE_GOLDEN_PATH.startedAt,
      durationMs: meeting.durationMs,
    });
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({
      eventId: SAMPLE_GOLDEN_PATH.eventId,
      eventTitle: SAMPLE_GOLDEN_PATH.eventTitle,
      matterId,
      householdRef: SAMPLE_GOLDEN_PATH.crmHouseholdKey,
    });
    expect(proposals).toEqual([
      expect.objectContaining({
        matterId,
        sourceRef: SAMPLE_GOLDEN_PATH.crmSourceRef,
        aiSource: {
          kind: 'meeting',
          date: SAMPLE_GOLDEN_PATH.startedAt.slice(0, 10),
        },
      }),
    ]);
    expect(SAMPLE_GOLDEN_PATH).toMatchObject({
      completedEventId: meeting.calendarEvent.id,
      briefEventId: meeting.calendarEvent.id,
      eventId: meeting.calendarEvent.id,
      eventTitle: meeting.calendarEvent.title,
      startedAt: meeting.calendarEvent.startUtc,
      endedAt: meeting.calendarEvent.endUtc,
      crmSourceRef: `meeting:${meeting.calendarEvent.id}`,
    });
    expect(useMatterStore.getState().matters[0]?.crmHouseholdKeys).toEqual([
      SAMPLE_GOLDEN_PATH.crmHouseholdKey,
    ]);
    expect((await population.findByReference(SAMPLE_GOLDEN_PATH.crmSourceRef))).toMatchObject({
      state: 'completed',
      ownerRef: null,
      legacyLink: { meetingDir: `Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}` },
    });
  });

  it('does not replace an existing private note manifest during recovery', async () => {
    const workspace = new InMemoryWorkspace();
    const population = samplePopulation();
    ensureSampleHendricksCrmLink(matterId);
    const path = `${workspaceRoot}/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}/meeting.json`;
    await workspace.writeFile(path, JSON.stringify({
      meetingFileVisibility: {
        version: 1,
        meetingSubject: {
          id: 'private-note', kind: 'meeting-note', lineage: 'root',
          ownerRef: 'advisor-a', visibilityPolicyId: 'meeting-file-visibility:owner-private',
        },
        files: {
          'notes.docx': { id: 'private-note:file:notes.docx', kind: 'file-reference', lineage: 'derived', parentRef: { id: 'private-note', kind: 'meeting-note' } },
        },
      },
    }));

    await seedSampleGoldenPath(workspace as unknown as WorkspaceService, workspaceRoot, matterId, population, sampleBoundary);

    const manifest = JSON.parse(await workspace.readFile(path)).meetingFileVisibility;
    expect(manifest).toMatchObject({
      meetingSubject: { ownerRef: 'advisor-a' },
    });
    expect(decideMeetingFileVisibility({
      manifest,
      fileName: 'notes.docx',
      context: { viewerId: null, policies: [FILE_MEETING_OWNER_PRIVATE_POLICY] },
    })).toBe(false);
    expect(decideMeetingFileVisibility({
      manifest,
      fileName: 'notes.docx',
      context: { viewerId: 'advisor-b', policies: [FILE_MEETING_OWNER_PRIVATE_POLICY] },
    })).toBe(false);
  });

  it('writes no sample files when canonical creation fails', async () => {
    const workspace = new InMemoryWorkspace();
    const population = samplePopulation();
    const operation = population.captureActiveClientOperationForBoundary(sampleBoundary);
    population.captureActiveClientOperationForBoundary = () => ({
      ...operation,
      createForActiveClient: async () => {
        throw new Error('canonical create failed');
      },
    });

    await expect(
      seedSampleGoldenPath(
        workspace as unknown as WorkspaceService,
        workspaceRoot,
        matterId,
        population,
        sampleBoundary
      )
    ).rejects.toThrow('canonical create failed');

    expect(workspace.textFiles).toEqual(new Map());
    expect(workspace.binaryFiles).toEqual(new Map());
    expect(useBriefStore.getState().briefs).toEqual({});
    expect(useCrmWriteQueueStore.getState().items).toEqual([]);
  });

  it('keeps a persisted draft and finishes exactly one meeting after a link retry', async () => {
    const workspace = new InMemoryWorkspace();
    const population = samplePopulation();
    const operation = population.captureActiveClientOperationForBoundary(sampleBoundary);
    const create = vi.fn(operation.createForActiveClient);
    const link = vi.fn(operation.linkLegacy);
    link.mockImplementationOnce(async () => {
      throw new Error('legacy link failed');
    });
    population.captureActiveClientOperationForBoundary = () => ({
      ...operation,
      createForActiveClient: create,
      linkLegacy: link,
    });

    await expect(
      seedSampleGoldenPath(workspace as unknown as WorkspaceService, workspaceRoot, matterId, population, sampleBoundary)
    ).rejects.toThrow('legacy link failed');
    expect(create).toHaveBeenCalledTimes(1);

    await seedSampleGoldenPath(
      workspace as unknown as WorkspaceService,
      workspaceRoot,
      matterId,
      population,
      sampleBoundary
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledTimes(2);
    await expect(
      population.findByReference(SAMPLE_GOLDEN_PATH.crmSourceRef)
    ).resolves.toMatchObject({
      ownerRef: null,
      state: 'completed',
      legacyLink: {
        meetingDir: `Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}`,
      },
    });
  });

  it.each([
    {
      label: 'malformed',
      visibility: { version: 1, meetingSubject: 'not-a-subject', files: {} },
    },
    {
      label: 'legacy unrestricted',
      visibility: {
        version: 1,
        meetingSubject: { id: 'legacy', kind: 'meeting-note', lineage: 'legacy-unrestricted' },
        files: {},
      },
    },
  ])('refuses $label visibility without broadening it', async ({ visibility }) => {
    const workspace = new InMemoryWorkspace();
    const population = samplePopulation();
    const path = `${workspaceRoot}/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}/meeting.json`;
    const original = JSON.stringify({ meetingFileVisibility: visibility });
    await workspace.writeFile(path, original);

    await expect(
      seedSampleGoldenPath(workspace as unknown as WorkspaceService, workspaceRoot, matterId, population, sampleBoundary)
    ).rejects.toThrow('could not be recovered safely');
    expect(await workspace.readFile(path)).toBe(original);
    expect(await population.findByReference(SAMPLE_GOLDEN_PATH.crmSourceRef)).toBeUndefined();
  });
});
