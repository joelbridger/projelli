import type { SourceRef } from '@/platform/clientMap/types';
import type { TranscriptSegment } from '@/platform/types/meeting';

export function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function meetingSourceRef(meetingDir: string, seg: TranscriptSegment): SourceRef {
  return {
    kind: 'meeting',
    ref: `meeting:${meetingDir}#${seg.startMs}`,
    snippet: seg.text,
    locator: mmss(seg.startMs),
  };
}

export function parseMeetingRef(ref: string): { meetingDir: string; startMs: number } | null {
  const m = ref.match(/^meeting:(.+)#(\d+)$/);
  if (!m) return null;
  return { meetingDir: m[1], startMs: Number(m[2]) };
}
