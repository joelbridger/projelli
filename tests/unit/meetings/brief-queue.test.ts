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
import type { SealedMeetingClientBoundary } from '@/features/meetings';

const event = (id: string) => ({
  id,
  provider: 'outlook' as const,
  title: 'Review',
  startUtc: '2026-07-02T16:00:00Z',
  endUtc: '2026-07-02T17:00:00Z',
  attendees: [],
  organizerEmail: '',
});

function clientBoundary(matterId: string): SealedMeetingClientBoundary {
  return {
    householdRef: `household-${matterId}`,
    matterId,
  } as SealedMeetingClientBoundary;
}

function job(matterId: string, eventId: string) {
  return { clientBoundary: clientBoundary(matterId), event: event(eventId) };
}

function keyFor(matterId: string, eventId: string): string {
  return briefKey({
    clientBoundary: clientBoundary(matterId),
    eventId,
    day: localDay(),
  });
}

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

describe('brief queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cancelBriefQueue();
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
    enqueueBriefs([job('m-1', 'e1'), job('m-2', 'e2')]);
    await vi.waitFor(() => {
      const briefs = useBriefStore.getState().briefs;
      const k1 = keyFor('m-1', 'e1');
      const k2 = keyFor('m-2', 'e2');
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
    enqueueBriefs([job('m-1', 'e1')]);
    await vi.waitFor(() =>
      expect(useBriefStore.getState().briefs[keyFor('m-1', 'e1')]?.status).toBe(
        'ready'
      )
    );
    enqueueBriefs([job('m-1', 'e1')]);
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
    enqueueBriefs([job('m-1', 'e1'), job('m-2', 'e2')]);
    await flush();
    cancelBriefQueue();
    release();
    await flush();
    expect(generate).toHaveBeenCalledTimes(1); // e2 never started
    const k2 = keyFor('m-2', 'e2');
    expect(useBriefStore.getState().briefs[k2]?.status).not.toBe('ready');
  });

  it('marks a failed brief failed with its error', async () => {
    generate.mockRejectedValue(new Error('provider down'));
    enqueueBriefs([job('m-1', 'e1')]);
    await vi.waitFor(() => {
      const b = useBriefStore.getState().briefs[keyFor('m-1', 'e1')];
      expect(b?.status).toBe('failed');
      expect(b?.error).toContain('provider down');
    });
  });
});
