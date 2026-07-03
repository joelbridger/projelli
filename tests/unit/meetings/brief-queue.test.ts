import { describe, expect, it, vi, beforeEach } from 'vitest';

const generate = vi.fn();
vi.mock('@/features/meetings/generateBrief', () => ({
  generateMeetingBrief: (...a: unknown[]) => generate(...a),
}));

import {
  cancelBriefQueue,
  enqueueBriefs,
} from '@/features/meetings/briefQueue';
import {
  briefKey,
  localDay,
  useBriefStore,
} from '@/features/meetings/briefStore';

const event = (id: string) => ({
  id,
  provider: 'outlook' as const,
  title: 'Review',
  startUtc: '2026-07-02T16:00:00Z',
  endUtc: '2026-07-02T17:00:00Z',
  attendees: [],
  organizerEmail: '',
});

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('brief queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBriefStore.setState({ briefs: {} });
  });

  it('runs jobs sequentially and stores results', async () => {
    let running = 0;
    generate.mockImplementation(async () => {
      running += 1;
      expect(running).toBe(1); // never parallel
      await flush();
      running -= 1;
      return { markdown: '# B', citations: [], generatedAt: 'now' };
    });
    enqueueBriefs([
      { matterId: 'm-1', event: event('e1') },
      { matterId: 'm-2', event: event('e2') },
    ]);
    await vi.waitFor(() => {
      const briefs = useBriefStore.getState().briefs;
      const k1 = briefKey(localDay(), 'e1', 'm-1');
      const k2 = briefKey(localDay(), 'e2', 'm-2');
      expect(briefs[k1]?.status).toBe('ready');
      expect(briefs[k2]?.status).toBe('ready');
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('skips briefs that are already fresh (ready, same day, not stale)', async () => {
    generate.mockResolvedValue({
      markdown: '# B',
      citations: [],
      generatedAt: 'now',
    });
    enqueueBriefs([{ matterId: 'm-1', event: event('e1') }]);
    await vi.waitFor(() =>
      expect(
        useBriefStore.getState().briefs[briefKey(localDay(), 'e1', 'm-1')]
          ?.status
      ).toBe('ready')
    );
    enqueueBriefs([{ matterId: 'm-1', event: event('e1') }]);
    await flush();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('cancel clears pending jobs', async () => {
    let release: () => void = () => {};
    generate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ markdown: '# B', citations: [], generatedAt: 'now' });
        })
    );
    enqueueBriefs([
      { matterId: 'm-1', event: event('e1') },
      { matterId: 'm-2', event: event('e2') },
    ]);
    await flush();
    cancelBriefQueue();
    release();
    await flush();
    expect(generate).toHaveBeenCalledTimes(1); // e2 never started
    const k2 = briefKey(localDay(), 'e2', 'm-2');
    expect(useBriefStore.getState().briefs[k2]?.status).not.toBe('ready');
  });

  it('marks a failed brief failed with its error', async () => {
    generate.mockRejectedValue(new Error('provider down'));
    enqueueBriefs([{ matterId: 'm-1', event: event('e1') }]);
    await vi.waitFor(() => {
      const b =
        useBriefStore.getState().briefs[briefKey(localDay(), 'e1', 'm-1')];
      expect(b?.status).toBe('failed');
      expect(b?.error).toContain('provider down');
    });
  });
});
