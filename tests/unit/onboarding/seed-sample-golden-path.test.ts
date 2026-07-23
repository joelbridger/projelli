import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureSampleHendricksCrmLink,
  seedSampleGoldenPath,
  SAMPLE_GOLDEN_PATH,
} from '@/features/onboarding/seedSampleGoldenPath';
import { useBriefStore } from '@/features/meetings/briefStore';
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
  [key: string]: unknown;
};

const sampleBoundary = {
  householdRef: SAMPLE_GOLDEN_PATH.crmHouseholdKey,
  matterId: 'sample-matter',
  selectionGeneration: 1,
} as never;

function makeSamplePopulation() {
  let record: SampleRecord | undefined;
  return {
    captureActiveClientOperationForBoundary: () => ({
      assertStable: () => undefined,
      findByReference: async (reference: string) =>
        record?.references.includes(reference) ? record : undefined,
      createForActiveClient: async (draft: Record<string, unknown>) => {
        record = {
          id: 'sample-canonical-meeting',
          kind: 'meeting', householdRef: sampleBoundary.householdRef, matterId: sampleBoundary.matterId,
          ...draft,
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

function reviewArtifacts() {
  const records: any[] = [];
  return { listForMeeting: (id: string) => records.filter((record) => record.meetingId === id), append: async (input: any) => {
    const id = `artifact-${records.length}`;
    const record = { ...input, id, householdRef: sampleBoundary.householdRef, matterId: sampleBoundary.matterId, state: 'produced', createdAt: input.producedAt, meetingVisibility: { kind: 'meeting-artifact', id, lineage: 'accountless-unrestricted' } };
    records.push(record); return record;
  }};
}

describe('seedSampleGoldenPath', () => {
  beforeEach(() => {
    localStorage.clear();
    useBriefStore.setState({ briefs: {} });
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

  it('seeds a processed meeting and a ready brief', async () => {
    const { service, textWrites, binaryWrites } = makeWorkspace();

    await seedSampleGoldenPath(
      service as never,
      '/workspace',
      'sample-matter',
      makeSamplePopulation() as never,
      sampleBoundary, reviewArtifacts()
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


    const matter = useMatterStore
      .getState()
      .matters.find((m) => m.id === 'sample-matter');
    expect(matter?.crmHouseholdKeys).toContain(
      SAMPLE_GOLDEN_PATH.crmHouseholdKey
    );
  });

  it('does not duplicate the review artifacts when re-seeded', async () => {
    const first = makeWorkspace();
    const second = makeWorkspace();
    const population = makeSamplePopulation();
    const artifacts = reviewArtifacts();

    await seedSampleGoldenPath(
      first.service as never,
      '/workspace',
      'sample-matter',
      population as never,
      sampleBoundary, artifacts
    );
    await seedSampleGoldenPath(
      second.service as never,
      '/workspace',
      'sample-matter',
      population as never,
      sampleBoundary, artifacts
    );

  });
});
