import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const enqueue = vi.fn();
vi.mock('@/features/meetings/briefQueue', () => ({
  enqueueBriefs: (...a: unknown[]) => enqueue(...a),
}));

const listEvents = vi.fn();
vi.mock('@/platform/utils/calendar-commands', () => ({
  calendarListEvents: (...args: unknown[]) => listEvents(...args),
}));

import {
  useMeetingAutoprep,
  useAutoprepRescan,
  RESCAN_INTERVAL_MS,
} from '@/features/meetings/useMeetingAutoprep';
import type { Matter } from '@/platform/types/matter';

const matter: Matter = {
  id: 'm-hend',
  name: 'Henderson',
  client: 'Kim Henderson',
  folderPaths: [],
  createdAt: '2024-01-01T00:00:00Z',
  meetingKeys: ['kim@henderson.com'],
  crmHouseholdKeys: ['household-hend'],
};

const baseEvent = {
  id: 'outlook:e1',
  provider: 'outlook' as const,
  title: 'Sync',
  startUtc: '2026-07-02T16:00:00Z',
  endUtc: '2026-07-02T17:00:00Z',
  attendees: [{ email: 'stranger@x.com', name: 'Stranger' }],
  organizerEmail: '',
};

describe('useMeetingAutoprep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-enqueues when the SAME event id becomes newly matched after its attendees change', () => {
    const { rerender } = renderHook(
      ({ events, matters }) => {
        useMeetingAutoprep(events, matters);
      },
      { initialProps: { events: [baseEvent], matters: [matter] } }
    );

    // Unmatched on first render: no attendee/organizer matches the taught
    // key, so the hook calls enqueueBriefs with an empty job list (a no-op).
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith([]);

    // Same event id, but the attendee changed to the taught client email —
    // this is the exact scenario the coordinator flagged: a re-synced event
    // (rescheduled, attendee list corrected) that only NOW matches.
    const changedEvent = {
      ...baseEvent,
      attendees: [{ email: 'kim@henderson.com', name: 'Kim' }],
    };
    rerender({ events: [changedEvent], matters: [matter] });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenLastCalledWith([
      {
        clientBoundary: {
          householdRef: 'household-hend',
          matterId: 'm-hend',
        },
        event: changedEvent,
      },
    ]);
  });
});

// QA-48: a calendar fetch failure during the periodic rescan must not read
// as "nothing to do" with no signal — the caller needs to know the check
// itself failed so it can show a "calendar refresh failed" state.
describe('useAutoprepRescan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listEvents.mockReset();
    enqueue.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onError and does NOT enqueue anything when calendarListEvents rejects', async () => {
    listEvents.mockRejectedValue(new Error('calendar backend unreachable'));
    const onError = vi.fn();

    renderHook(
      ({ matters }) => {
        useAutoprepRescan(matters, onError);
      },
      {
        initialProps: { matters: [matter] },
      }
    );

    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does NOT call onError on a successful rescan', async () => {
    listEvents.mockResolvedValue([]);
    const onError = vi.fn();

    renderHook(
      ({ matters }) => {
        useAutoprepRescan(matters, onError);
      },
      {
        initialProps: { matters: [matter] },
      }
    );

    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS);
    expect(onError).not.toHaveBeenCalled();
  });
});
