import { describe, it, expect } from 'vitest';
import { scanKeywords } from '@/features/meetings/keywordTracking';

const t = { segments: [
  { startMs: 1000, endMs: 4000, channel: 'sys' as const, speaker: 'Them', text: 'We are nervous about crypto exposure.' },
  { startMs: 8000, endMs: 12000, channel: 'mic' as const, speaker: 'You', text: 'Let us walk through the 401(k) rollover and the crypto question.' },
], meta: {} } as never;

describe('keyword scan', () => {
  it('counts case-insensitive whole-word hits with timestamps', () => {
    const r = scanKeywords(t, ['crypto', '401(k) rollover']);
    expect(r.find((h) => h.term === 'crypto')?.count).toBe(2);
    expect(r.find((h) => h.term === 'crypto')?.hits[0]?.startMs).toBe(1000);
    expect(r.find((h) => h.term === '401(k) rollover')?.count).toBe(1);
  });
  it('no partial-word matches and empty terms are ignored', () => {
    expect(scanKeywords(t, ['rypto'])).toEqual([{ term: 'rypto', count: 0, hits: [] }].filter(() => false));
    expect(scanKeywords(t, ['', '  '])).toEqual([]);
  });
});
