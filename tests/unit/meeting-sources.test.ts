import { describe, it, expect } from 'vitest';
import { meetingSourceRef, parseMeetingRef } from '@/features/meetings/meetingSources';

describe('meeting source refs', () => {
  const seg = { startMs: 875000, endMs: 880000, channel: 'sys' as const, speaker: 'Them', text: 'fund the 529' };
  it('builds a ref with kind meeting and mm:ss locator', () => {
    const ref = meetingSourceRef('/ws/Clients/H/Meetings/2026-07-02-m1', seg);
    expect(ref.kind).toBe('meeting');
    expect(ref.ref).toBe('meeting:/ws/Clients/H/Meetings/2026-07-02-m1#875000');
    expect(ref.locator).toBe('14:35');
  });
  it('round-trips through parseMeetingRef', () => {
    const parsed = parseMeetingRef('meeting:/ws/x/Meetings/2026-07-02-m1#875000');
    expect(parsed).toEqual({ meetingDir: '/ws/x/Meetings/2026-07-02-m1', startMs: 875000 });
  });
});
