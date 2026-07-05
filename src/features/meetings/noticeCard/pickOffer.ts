/**
 * Notice Card — pick the online meeting to offer the card for.
 *
 * Given the advisor's calendar events and "now", find the event happening now
 * (within a grace window) that has a join URL we can classify. Pure + tested;
 * the consent dialog uses the result to pre-fill its offer.
 */
import { detectPlatform } from './meetingPlatform';
import type { NoticeCardPlatform } from './noticeCardTypes';

export interface CalendarEventLike {
  title: string;
  startUtc: string;
  endUtc: string;
  joinUrl?: string;
}

export interface NoticeCardOffer {
  joinUrl: string;
  platform: NoticeCardPlatform;
  meetingTitle: string;
}

const DEFAULT_GRACE_MS = 5 * 60 * 1000; // ±5 minutes around now

/**
 * The best online meeting to offer the card for, or null if none is happening
 * now. Prefers a meeting currently in progress; otherwise the one starting
 * soonest within the grace window. Events with no classifiable join URL
 * ('none') are ignored.
 */
export function pickNoticeCardOffer(
  events: CalendarEventLike[],
  nowMs: number,
  graceMs: number = DEFAULT_GRACE_MS,
): NoticeCardOffer | null {
  const candidates = events
    .map((e) => ({ e, start: Date.parse(e.startUtc), end: Date.parse(e.endUtc), platform: detectPlatform(e.joinUrl) }))
    .filter((c) => c.e.joinUrl && c.platform !== 'none')
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    // Overlaps [now-grace, now+grace].
    .filter((c) => c.start <= nowMs + graceMs && c.end >= nowMs - graceMs);
  if (candidates.length === 0) return null;

  // In-progress meetings first; then the soonest-starting.
  candidates.sort((a, b) => {
    const aLive = a.start <= nowMs && nowMs <= a.end ? 0 : 1;
    const bLive = b.start <= nowMs && nowMs <= b.end ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return Math.abs(a.start - nowMs) - Math.abs(b.start - nowMs);
  });
  const best = candidates[0];
  if (!best) return null;
  const { joinUrl } = best.e;
  if (!joinUrl) return null; // guaranteed by the filter; keeps the type honest
  return { joinUrl, platform: best.platform, meetingTitle: best.e.title };
}
