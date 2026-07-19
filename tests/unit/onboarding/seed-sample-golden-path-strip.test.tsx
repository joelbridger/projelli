import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { seedSampleGoldenPath } from '@/features/onboarding/seedSampleGoldenPath';
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
      'sample-matter'
    );

    vi.setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
    render(<BeforeYouMeetStrip matterId="sample-matter" />);

    expect(screen.getByTestId('before-you-meet').textContent).toContain(
      'Hendricks planning check-in'
    );
  });
});
