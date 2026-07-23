import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSampleHendricksCrmLink,
  seedSampleGoldenPath,
  SAMPLE_GOLDEN_PATH,
} from '@/features/onboarding/seedSampleGoldenPath';
import { useBriefStore } from '@/features/meetings/briefStore';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { MeetingMeta } from '@/features/meetings/meetingStore';
import type { TranscriptFile } from '@/platform/types/meeting';

vi.mock('@/platform/utils/docx-io', () => ({
  markdownToDocxBytes: vi.fn(async () => new Uint8Array([80, 75, 3, 4])),
}));

function makeWorkspace() {
  const textWrites = new Map<string, string>();
  const binaryWrites = new Map<string, ArrayBuffer>();
  return {
    textWrites,
    binaryWrites,
    service: {
      writeFile: vi.fn(async (path: string, content: string) => {
        textWrites.set(path, content);
      }),
      writeFileBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
        binaryWrites.set(path, content);
      }),
    },
  };
}

type SampleRecord = {
  id: string;
  state: 'draft' | 'scheduled' | 'in-progress' | 'completed';
  references: readonly string[];
};

function makeSamplePopulation() {
  let record: SampleRecord | undefined;
  return {
    captureActiveClientOperation: () => ({
      assertStable: () => undefined,
      findByReference: async (reference: string) =>
        record?.references.includes(reference) ? record : undefined,
      createForActiveClient: async () => {
        record = {
          id: 'sample-canonical-meeting',
          state: 'draft',
          references: [SAMPLE_GOLDEN_PATH.crmSourceRef],
        };
        return record;
      },
      linkLegacy: async () => {
        if (!record) throw new Error('Missing canonical sample meeting.');
        return record;
      },
      transition: async (
        _id: string,
        transition: {
          from: 'draft' | 'scheduled' | 'in-progress';
          to: 'scheduled' | 'in-progress' | 'completed';
        }
      ) => {
        if (!record || record.state !== transition.from)
          throw new Error('Illegal sample transition.');
        record = { ...record, state: transition.to };
        return record;
      },
    }),
  };
}

describe('seedSampleGoldenPath', () => {
  beforeEach(() => {
    localStorage.clear();
    useBriefStore.setState({ briefs: {} });
    useCrmWriteQueueStore.setState({ items: [] });
    useMatterStore.setState({
      matters: [
        {
          id: 'sample-matter',
          name: 'The Hendricks Household',
          client: 'The Hendricks Household',
          folderPaths: ['/workspace'],
          isSample: true,
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
    });
    ensureSampleHendricksCrmLink('sample-matter');
  });

  it('seeds a processed meeting, a ready brief, and one pending CRM approval', async () => {
    const { service, textWrites, binaryWrites } = makeWorkspace();

    await seedSampleGoldenPath(
      service as never,
      '/workspace',
      'sample-matter',
      makeSamplePopulation() as never
    );

    const meetingPath = `/workspace/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}/meeting.json`;
    const transcriptPath = `/workspace/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}/transcript.json`;
    const notesPath = `/workspace/Meetings/${SAMPLE_GOLDEN_PATH.meetingFolder}/notes.docx`;

    expect(textWrites.has(meetingPath)).toBe(true);
    expect(textWrites.has(transcriptPath)).toBe(true);
    expect(binaryWrites.has(notesPath)).toBe(true);

    const meta = JSON.parse(textWrites.get(meetingPath) ?? '{}') as MeetingMeta;
    expect(meta.matterId).toBe('sample-matter');
    expect(meta.typeId).toBe('annual-review');
    expect(meta.reviewedAt).toBeTruthy();
    expect(meta.calendarEvent?.id).toBe(SAMPLE_GOLDEN_PATH.completedEventId);

    const transcript = JSON.parse(
      textWrites.get(transcriptPath) ?? '{}'
    ) as TranscriptFile;
    expect(transcript.segments.length).toBeGreaterThan(0);
    expect(transcript.meta.matterId).toBe('sample-matter');

    const briefs = Object.values(useBriefStore.getState().briefs);
    expect(briefs).toHaveLength(1);
    expect(briefs[0]?.status).toBe('ready');
    expect(briefs[0]?.householdRef).toBe(SAMPLE_GOLDEN_PATH.crmHouseholdKey);
    expect(briefs[0]?.eventId).toBe(SAMPLE_GOLDEN_PATH.briefEventId);
    expect(briefs[0]?.eventId).toBe(meta.calendarEvent?.id);
    expect(briefs[0]?.eventTitle).toBe('Hendricks annual review');
    expect(briefs[0]?.isSample).toBe(true);
    expect(briefs[0]?.bullets?.length).toBe(3);

    const queueItems = useCrmWriteQueueStore.getState().items;
    expect(queueItems).toHaveLength(1);
    expect(queueItems[0]?.status).toBe('proposed');
    expect(queueItems[0]?.sourceRef).toBe(SAMPLE_GOLDEN_PATH.crmSourceRef);

    const matter = useMatterStore
      .getState()
      .matters.find((m) => m.id === 'sample-matter');
    expect(matter?.crmHouseholdKeys).toContain(
      SAMPLE_GOLDEN_PATH.crmHouseholdKey
    );
  });

  it('does not duplicate the pending CRM approval when re-seeded', async () => {
    const first = makeWorkspace();
    const second = makeWorkspace();
    const population = makeSamplePopulation();

    await seedSampleGoldenPath(
      first.service as never,
      '/workspace',
      'sample-matter',
      population as never
    );
    await seedSampleGoldenPath(
      second.service as never,
      '/workspace',
      'sample-matter',
      population as never
    );

    expect(useCrmWriteQueueStore.getState().items).toHaveLength(1);
  });
});
