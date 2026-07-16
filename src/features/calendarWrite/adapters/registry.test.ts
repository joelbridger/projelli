import { describe, expect, it } from 'vitest';
import { getWriteAdapter, listWriteAdapters } from './registry';
import type { CalendarWriteProviderAdapter } from './types';
import type { CalendarWriteProposal, CalendarWriteProviderId } from '../types';

function mustGetAdapter(provider: CalendarWriteProviderId): CalendarWriteProviderAdapter {
  const adapter = getWriteAdapter(provider);
  if (!adapter) throw new Error(`no adapter for ${provider}`);
  return adapter;
}

function proposal(overrides: Partial<CalendarWriteProposal> = {}): CalendarWriteProposal {
  return {
    id: 'p1',
    kind: 'create',
    provider: 'outlook',
    targetCalendarId: 'cal-home',
    status: 'prepared',
    idempotencyKey: 'abcdef0123456789abcdef0123456789',
    event: {
      title: 'Review',
      startUtc: '2026-02-01T15:00:00Z',
      endUtc: '2026-02-01T15:30:00Z',
      displayTimezone: 'America/New_York',
      allDay: false,
      location: 'Room 4',
      notes: 'bring docs',
    },
    grantVersion: 2,
    createdAtUtc: '2026-02-01T00:00:00Z',
    updatedAtUtc: '2026-02-01T00:00:00Z',
    ...overrides,
  };
}

describe('write adapter registry', () => {
  it('registers outlook and google, and nothing else', () => {
    expect(listWriteAdapters().map((a) => a.provider).sort()).toEqual(['google', 'outlook']);
    expect(getWriteAdapter('outlook')?.egressOperationId).toBe('calendar-write-microsoft');
    expect(getWriteAdapter('google')?.egressOperationId).toBe('calendar-write-google');
  });
});

describe('outlook adapter request building', () => {
  const adapter = mustGetAdapter('outlook');

  it('assigns transactionId = idempotency key on create (dedupes a replay)', () => {
    const req = adapter.buildWriteRequest(proposal());
    expect(req.method).toBe('create');
    expect(req.operationId).toBe('calendar-write-microsoft');
    expect(req.body['transactionId']).toBe('abcdef0123456789abcdef0123456789');
    expect(req.body['subject']).toBe('Review');
    // No secret / token fields are ever assembled.
    expect(JSON.stringify(req)).not.toMatch(/token|client_id|authorize|Bearer/i);
  });

  it('uses If-Match (expectedVersion) and target event on update; no transactionId', () => {
    const req = adapter.buildWriteRequest(
      proposal({
        kind: 'update',
        target: {
          providerEventId: 'evt-7',
          providerCalendarId: 'cal-home',
          expectedVersion: 'W/"5"',
          seriesKind: 'single',
          ownership: 'organizer-self',
          canWrite: true,
        },
      }),
    );
    expect(req.method).toBe('update');
    expect(req.targetEventId).toBe('evt-7');
    expect(req.expectedVersion).toBe('W/"5"');
    expect(req.body['transactionId']).toBeUndefined();
  });
});

describe('google adapter request building', () => {
  const adapter = mustGetAdapter('google');

  it('assigns the idempotency key as the event id on create (idempotent insert)', () => {
    const req = adapter.buildWriteRequest(proposal({ provider: 'google' }));
    expect(req.operationId).toBe('calendar-write-google');
    expect(req.body['id']).toBe('abcdef0123456789abcdef0123456789');
    expect(req.body['summary']).toBe('Review');
    expect(req.body['start']).toEqual({ dateTime: '2026-02-01T15:00:00Z', timeZone: 'UTC' });
  });

  it('emits date (not dateTime) for an all-day event', () => {
    const req = adapter.buildWriteRequest(
      proposal({
        provider: 'google',
        event: {
          title: 'Off',
          startUtc: '2026-03-01T00:00:00Z',
          endUtc: '2026-03-02T00:00:00Z',
          displayTimezone: 'America/New_York',
          allDay: true,
          location: null,
          notes: null,
        },
      }),
    );
    expect(req.body['start']).toEqual({ date: '2026-03-01' });
    expect(req.body['end']).toEqual({ date: '2026-03-02' });
  });
});
