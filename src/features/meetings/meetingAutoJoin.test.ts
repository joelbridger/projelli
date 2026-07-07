import { describe, expect, it } from 'vitest';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import type { Matter } from '@/platform/types/matter';
import {
  autoJoinEventKey,
  discoverAutoJoinMeetings,
  nextAutoJoinAction,
} from './meetingAutoJoin';

const NOW = Date.parse('2026-07-07T16:00:00Z');

function event(overrides: Partial<CalendarEventDto> & { id: string }): CalendarEventDto {
  return {
    provider: 'outlook',
    title: 'Henderson review',
    startUtc: '2026-07-07T16:05:00Z',
    endUtc: '2026-07-07T17:00:00Z',
    attendees: [{ email: 'kim@henderson.test', name: 'Kim Henderson' }],
    organizerEmail: 'advisor@firm.test',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/henderson',
    ...overrides,
  };
}

function matter(overrides: Partial<Matter>): Matter {
  return {
    id: 'matter-henderson',
    name: 'Henderson Family',
    client: 'Henderson Family',
    folderPaths: ['/ws/Clients/Henderson'],
    createdAt: '2026-07-07T00:00:00Z',
    meetingKeys: ['kim@henderson.test'],
    ...overrides,
  };
}

describe('MF3 auto-join discovery', () => {
  it('finds opted-in Teams and Zoom meetings matched to exactly one client', () => {
    const zoom = event({
      id: 'zoom-1',
      provider: 'google',
      joinUrl: 'https://us02web.zoom.us/j/123',
    });
    const teams = event({ id: 'teams-1' });

    const discovery = discoverAutoJoinMeetings(
      [zoom, teams],
      [matter({})],
      { outlook: true, google: true },
      new Set(),
      NOW,
    );

    expect(discovery.willJoin.map((candidate) => candidate.platform)).toEqual(['zoom', 'teams']);
    expect(discovery.willJoin.every((candidate) => candidate.matterId === 'matter-henderson')).toBe(true);
  });

  it('detects Google Meet links but does not auto-join them until there is a Notice Card adapter', () => {
    const meet = event({
      id: 'meet-1',
      provider: 'google',
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    });

    const discovery = discoverAutoJoinMeetings(
      [meet],
      [matter({})],
      { google: true },
      new Set(),
      NOW,
    );

    expect(discovery.willJoin).toEqual([]);
    expect(discovery.skipped).toMatchObject([
      { key: autoJoinEventKey(meet), reason: 'unsupported-platform', platform: 'meet' },
    ]);
  });

  it('requires opt-in for the event provider before a matching meeting can join', () => {
    const teams = event({ id: 'teams-1', provider: 'outlook' });
    const discovery = discoverAutoJoinMeetings(
      [teams],
      [matter({})],
      { google: true },
      new Set(),
      NOW,
    );

    expect(discovery.willJoin).toEqual([]);
    expect(discovery.skipped[0]?.reason).toBe('calendar-not-opted-in');
  });

  it('refuses disabled, no-link, declined, cancelled, unmatched, and ambiguous meetings', () => {
    const disabled = event({ id: 'disabled' });
    const noLink = event({ id: 'no-link' });
    delete noLink.joinUrl;
    const declined = { ...event({ id: 'declined' }), selfDeclined: true } as CalendarEventDto;
    const cancelled = { ...event({ id: 'cancelled' }), isCancelled: true } as CalendarEventDto;
    const unmatched = event({
      id: 'unmatched',
      attendees: [{ email: 'other@example.test', name: 'Other Client' }],
      title: 'Other Client',
    });
    const ambiguous = event({
      id: 'ambiguous',
      attendees: [
        { email: 'kim@henderson.test', name: 'Kim Henderson' },
        { email: 'sam@ortiz.test', name: 'Sam Ortiz' },
      ],
    });

    const discovery = discoverAutoJoinMeetings(
      [disabled, noLink, declined, cancelled, unmatched, ambiguous],
      [
        matter({}),
        matter({
          id: 'matter-ortiz',
          name: 'Ortiz Family',
          client: 'Ortiz Family',
          folderPaths: ['/ws/Clients/Ortiz'],
          meetingKeys: ['sam@ortiz.test'],
        }),
      ],
      { outlook: true },
      new Set([autoJoinEventKey(disabled)]),
      NOW,
    );

    expect(discovery.willJoin).toEqual([]);
    expect(discovery.skipped.map((item) => item.reason)).toEqual([
      'meeting-disabled',
      'no-link',
      'declined',
      'cancelled',
      'unmatched-client',
      'ambiguous-client',
    ]);
  });
});

describe('MF3 auto-join scheduler planning', () => {
  it('hands off when the next meeting is due while another recording is active', () => {
    const first = event({
      id: 'first',
      startUtc: '2026-07-07T15:00:00Z',
      endUtc: '2026-07-07T16:00:00Z',
    });
    const second = event({
      id: 'second',
      startUtc: '2026-07-07T16:00:00Z',
      endUtc: '2026-07-07T17:00:00Z',
    });
    const discovery = discoverAutoJoinMeetings(
      [first, second],
      [matter({})],
      { outlook: true },
      new Set(),
      NOW,
    );

    const action = nextAutoJoinAction(discovery.willJoin, NOW, true, new Set([autoJoinEventKey(first)]));

    expect(action?.type).toBe('handoff');
    expect(action?.candidate.event.id).toBe('second');
  });
});
