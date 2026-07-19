import { describe, expect, it, beforeEach } from 'vitest';
import { markBriefsStaleForPath } from '@/features/meetings/useBriefStaleness';
import {
  briefKey,
  localDay,
  useBriefStore,
} from '@/features/meetings/briefStore';
import type { Matter } from '@/platform/types/matter';
import type { SealedMeetingClientBoundary } from '@/features/meetings';

const clientBoundary = {
  householdRef: 'household-hend',
  matterId: 'm-hend',
} as SealedMeetingClientBoundary;

function keyFor(): string {
  return briefKey({ clientBoundary, eventId: 'e1', day: localDay() });
}

const matters: Matter[] = [
  {
    id: 'm-hend',
    name: 'Henderson',
    client: 'Kim Henderson',
    folderPaths: ['/ws/Henderson'],
    crmHouseholdKeys: [clientBoundary.householdRef],
    createdAt: '2024-01-01T00:00:00Z',
  },
];

describe('markBriefsStaleForPath', () => {
  beforeEach(() => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-hend',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# B',
          citations: [],
          eventTitle: 'Review',
        },
      },
    });
  });

  it('marks the matched client briefs stale for a file in its folder', () => {
    const got = markBriefsStaleForPath(
      '/ws/Henderson/new-statement.pdf',
      matters
    );
    expect(got).toEqual([clientBoundary]);
    const brief = useBriefStore.getState().briefs[keyFor()];
    expect(brief?.stale).toBe(true);
  });

  it('does nothing for files outside every client folder', () => {
    const got = markBriefsStaleForPath('/ws/Somewhere/else.pdf', matters);
    expect(got).toBeNull();
    const brief = useBriefStore.getState().briefs[keyFor()];
    expect(brief?.stale).toBe(false);
  });
});
