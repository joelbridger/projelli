import { describe, it, expect } from 'vitest';
import type { TranscriptFile } from '@/platform/types/meeting';

describe('meeting transcript schema', () => {
  it('accepts the canonical wire shape produced by transcribe_meeting', () => {
    const wire = {
      segments: [{ startMs: 0, endMs: 4200, channel: 'mic', speaker: 'You', text: 'hi' }],
      meta: {
        startedAt: '2026-07-02T17:03:00Z',
        durationMs: 2460000,
        matterId: 'm-abc123',
        consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-02T17:02:58Z' },
      },
    } satisfies TranscriptFile;
    expect(wire.segments[0].speaker).toBe('You');
  });
});
