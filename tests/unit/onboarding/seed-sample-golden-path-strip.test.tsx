import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ensureSampleHendricksCrmLink,
  SAMPLE_GOLDEN_PATH,
  seedSampleGoldenPath,
} from '@/features/onboarding/seedSampleGoldenPath';
import { BeforeYouMeetStrip } from '@/features/meetings/BeforeYouMeetStrip';
import { useBriefStore } from '@/features/meetings/briefStore';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMatterStore } from '@/platform/matter/matterStore';

vi.mock('@/platform/utils/docx-io', () => ({
  markdownToDocxBytes: vi.fn(async () => new Uint8Array([80, 75, 3, 4])),
}));
vi.mock('@/features/meetings/foundation/contract', () => ({
  useActiveMeetingClientBoundary: () => ({
    householdRef: 'sample-hendricks-household',
    matterId: 'sample-matter',
  }),
}));

function makeWorkspace() {
  return {
    writeFile: vi.fn(async () => undefined),
    writeFileBinary: vi.fn(async () => undefined),
  };
}

const sampleBoundary = {
  householdRef: SAMPLE_GOLDEN_PATH.crmHouseholdKey,
  matterId: 'sample-matter',
  selectionGeneration: 1,
} as never;

function makeSamplePopulation() {
  let record: {
    id: string;
    state: 'draft' | 'scheduled' | 'in-progress' | 'completed';
    references: readonly string[];
  } | undefined;
  return {
    captureActiveClientOperationForBoundary: () => ({
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

describe('seedSampleGoldenPath BeforeYouMeetStrip behavior', () => {
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
          createdAt: '2026-07-09T12:00:00.000Z',
          isSample: true,
        },
      ],
    });
    ensureSampleHendricksCrmLink('sample-matter');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('still renders the seeded sample brief tomorrow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T12:00:00.000Z'));

    await seedSampleGoldenPath(
      makeWorkspace() as never,
      '/workspace',
      'sample-matter',
      makeSamplePopulation() as never,
      sampleBoundary
    );

    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    render(<BeforeYouMeetStrip matterId="sample-matter" />);

    expect(screen.getByTestId('before-you-meet').textContent).toContain(
      'Hendricks annual review'
    );
  });
});
