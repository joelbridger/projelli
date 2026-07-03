import { describe, expect, it, beforeEach } from 'vitest';
import { markBriefsStaleForPath } from '@/features/meetings/useBriefStaleness';
import {
  briefKey,
  localDay,
  useBriefStore,
} from '@/features/meetings/briefStore';
import type { Matter } from '@/platform/types/matter';

const matters: Matter[] = [
  {
    id: 'm-hend',
    name: 'Henderson',
    client: 'Kim Henderson',
    folderPaths: ['/ws/Henderson'],
    createdAt: '2024-01-01T00:00:00Z',
  },
];

describe('markBriefsStaleForPath', () => {
  beforeEach(() => {
    const key = briefKey(localDay(), 'e1', 'm-hend');
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
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
    expect(got).toBe('m-hend');
    const brief =
      useBriefStore.getState().briefs[briefKey(localDay(), 'e1', 'm-hend')];
    expect(brief?.stale).toBe(true);
  });

  it('does nothing for files outside every client folder', () => {
    const got = markBriefsStaleForPath('/ws/Somewhere/else.pdf', matters);
    expect(got).toBeNull();
    const brief =
      useBriefStore.getState().briefs[briefKey(localDay(), 'e1', 'm-hend')];
    expect(brief?.stale).toBe(false);
  });
});
