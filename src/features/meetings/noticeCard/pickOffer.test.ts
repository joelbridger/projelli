import { describe, it, expect } from 'vitest';
import { pickNoticeCardOffer, type CalendarEventLike } from './pickOffer';
import { resolveMattersForCalendarEvent } from '@/platform/rag/matterResolver';

const NOW = Date.parse('2026-07-04T16:15:00Z');
const ev = (over: Partial<CalendarEventLike>): CalendarEventLike => ({
  title: 'Meeting',
  startUtc: '2026-07-04T16:00:00Z',
  endUtc: '2026-07-04T17:00:00Z',
  joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
  ...over,
});

describe('pickNoticeCardOffer', () => {
  it('picks the in-progress meeting with a classifiable join URL', () => {
    const offer = pickNoticeCardOffer([ev({ title: 'Henderson review' })], NOW);
    expect(offer).toMatchObject({ platform: 'teams', meetingTitle: 'Henderson review' });
  });

  it('ignores events with no join URL or an unclassifiable one', () => {
    const noLink: CalendarEventLike = { title: 'In person', startUtc: ev({}).startUtc, endUtc: ev({}).endUtc };
    expect(pickNoticeCardOffer([noLink], NOW)).toBeNull();
    expect(pickNoticeCardOffer([ev({ joinUrl: 'not a url' })], NOW)).toBeNull();
  });

  it('ignores meetings far outside the grace window', () => {
    const far = ev({ startUtc: '2026-07-04T20:00:00Z', endUtc: '2026-07-04T21:00:00Z' });
    expect(pickNoticeCardOffer([far], NOW)).toBeNull();
  });

  it('includes a meeting starting within the grace window (about to begin)', () => {
    const soon = ev({ startUtc: '2026-07-04T16:18:00Z', endUtc: '2026-07-04T17:00:00Z' }); // +3min
    expect(pickNoticeCardOffer([soon], NOW)?.platform).toBe('teams');
  });

  it('prefers an in-progress meeting over one merely near the window', () => {
    const live = ev({ title: 'Live', joinUrl: 'https://zoom.us/j/1' });
    const soon = ev({ title: 'Soon', startUtc: '2026-07-04T16:19:00Z', endUtc: '2026-07-04T17:00:00Z' });
    const offer = pickNoticeCardOffer([soon, live], NOW);
    expect(offer?.meetingTitle).toBe('Live');
    expect(offer?.platform).toBe('zoom');
  });

  // Codex R7 P1: with two concurrent meetings for different clients, the offer
  // must be scoped to the CURRENT client so the card never launches into the
  // wrong client's call. This composes the real matter resolver with the picker
  // exactly as ClientMeetingsTab does.
  it('scopes the offer to the current client (never the other client\'s concurrent meeting)', () => {
    const entries = [
      { key: 'alice@clienta.com', matterId: 'matter-A' },
      { key: 'bob@clientb.com', matterId: 'matter-B' },
    ];
    const meetingA = {
      title: 'Client A review',
      startUtc: '2026-07-04T16:00:00Z',
      endUtc: '2026-07-04T17:00:00Z',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/a',
      attendees: [{ email: 'alice@clienta.com', name: 'Alice' }],
      organizerEmail: 'adv@firm.com',
    };
    const meetingB = {
      title: 'Client B call',
      startUtc: '2026-07-04T16:00:00Z',
      endUtc: '2026-07-04T17:00:00Z',
      joinUrl: 'https://zoom.us/j/999',
      attendees: [{ email: 'bob@clientb.com', name: 'Bob' }],
      organizerEmail: 'adv@firm.com',
    };
    const all = [meetingA, meetingB];
    const forA = all.filter((e) => resolveMattersForCalendarEvent(e, entries).includes('matter-A'));
    const forB = all.filter((e) => resolveMattersForCalendarEvent(e, entries).includes('matter-B'));
    expect(pickNoticeCardOffer(forA, NOW)?.meetingTitle).toBe('Client A review');
    expect(pickNoticeCardOffer(forA, NOW)?.platform).toBe('teams');
    expect(pickNoticeCardOffer(forB, NOW)?.meetingTitle).toBe('Client B call');
    // A client with no matching meeting gets no auto offer (falls back to manual).
    const forC = all.filter((e) => resolveMattersForCalendarEvent(e, entries).includes('matter-C'));
    expect(pickNoticeCardOffer(forC, NOW)).toBeNull();
  });
});
