import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const listEvents = vi.fn();
vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarListEvents: (...a: unknown[]) => listEvents(...a),
}));
const enqueue = vi.fn();
vi.mock('@/features/meetings/briefQueue', () => ({
  enqueueBriefs: (...a: unknown[]) => enqueue(...a),
}));

import { renderHook } from '@testing-library/react';
import { useAutoprepRescan, RESCAN_INTERVAL_MS } from '@/features/meetings/useMeetingAutoprep';

describe('useAutoprepRescan', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('rescans on the interval and enqueues matched jobs while mounted', async () => {
    listEvents.mockResolvedValue([{
      id: 'e-new', provider: 'outlook', title: 'x',
      startUtc: '2026-07-02T20:00:00Z', endUtc: '2026-07-02T21:00:00Z',
      attendees: [{ email: 'kim@henderson.com', name: 'Kim' }], organizerEmail: '',
    }]);
    const matters = [{
      id: 'm-hend', name: 'Henderson', client: 'Kim Henderson',
      folderPaths: [], createdAt: '2024-01-01T00:00:00Z',
      meetingKeys: ['kim@henderson.com'],
      crmHouseholdKeys: ['hh-hend'],
    }];
    const { unmount } = renderHook(() => useAutoprepRescan(matters));
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS + 10);
    expect(listEvents).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith([
      expect.objectContaining({
        clientBoundary: expect.objectContaining({
          matterId: 'm-hend',
          householdRef: 'hh-hend',
        }),
      }),
    ]);
    unmount();
    const calls = enqueue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RESCAN_INTERVAL_MS * 3);
    expect(enqueue.mock.calls.length).toBe(calls); // stops after unmount
  });
});
