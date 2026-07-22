import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useBriefStore } from '@/features/meetings';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  SAMPLE_GOLDEN_PATH,
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
}

const matterId = 'matter-hendricks';
const workspaceRoot = '/temporary-hendricks-workspace';

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

    await seedSampleGoldenPath(
      workspace as unknown as WorkspaceService,
      workspaceRoot,
      matterId
    );
    // Re-running onboarding must update the same sample artifacts, not add a
    // second CRM item awaiting advisor approval.
    await seedSampleGoldenPath(
      workspace as unknown as WorkspaceService,
      workspaceRoot,
      matterId
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
  });
});
