import { describe, expect, it } from 'vitest';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import {
  buildBusyFreeSnapshotFromCalendarEvents,
  loadBusyFreeSnapshotFromCalendarStore,
} from './busyFreeProjection';

function event(overrides: Partial<CalendarEventDto> = {}): CalendarEventDto {
  return {
    id: 'outlook:e1',
    provider: 'outlook',
    title: 'Henderson annual review',
    startUtc: '2026-07-06T15:00:00Z',
    endUtc: '2026-07-06T16:00:00Z',
    attendees: [{ email: 'client@example.com', name: 'Client Name' }],
    organizerEmail: 'advisor@example.com',
    joinUrl: 'https://meet.example.com/private',
    ...overrides,
  };
}

describe('busy/free calendar projection', () => {
  it('strips calendar details down to opaque busy blocks', () => {
    const snapshot = buildBusyFreeSnapshotFromCalendarEvents([
      {
        ...event(),
        location: 'Main office',
      } as CalendarEventDto & { location: string },
    ]);

    expect(snapshot).toEqual({
      busy: [{ startUtc: '2026-07-06T15:00:00Z', endUtc: '2026-07-06T16:00:00Z' }],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('Henderson');
    expect(serialized).not.toContain('client@example.com');
    expect(serialized).not.toContain('Main office');
    expect(serialized).not.toContain('https://meet.example.com/private');
  });

  it('fails closed for cancelled, declined, and invalid calendar rows', () => {
    const snapshot = buildBusyFreeSnapshotFromCalendarEvents([
      event({ id: 'good' }),
      event({ id: 'cancelled', isCancelled: true }),
      event({ id: 'declined', selfDeclined: true }),
      event({ id: 'bad-time', startUtc: 'not-a-date' }),
    ]);

    expect(snapshot.busy).toEqual([
      { startUtc: '2026-07-06T15:00:00Z', endUtc: '2026-07-06T16:00:00Z' },
    ]);
  });

  it('loads the projection from the existing calendar read helper', async () => {
    const snapshot = await loadBusyFreeSnapshotFromCalendarStore(
      '2026-07-06T00:00:00Z',
      '2026-07-07T00:00:00Z',
      () => Promise.resolve([
        event({
          title: 'Do not leak this title',
          attendees: [{ email: 'do-not-leak@example.com', name: 'Private Client' }],
        }),
      ]),
    );

    expect(snapshot).toEqual({
      busy: [{ startUtc: '2026-07-06T15:00:00Z', endUtc: '2026-07-06T16:00:00Z' }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('do-not-leak');
  });
});
