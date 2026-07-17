import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  commands: [] as string[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
  records: [] as LiveCrmRecord[],
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => canonical.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: { matters: []; activeMatterId: null }) => T) => selector({ matters: [], activeMatterId: null }),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

import {
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  type BookingAvailabilityDraft,
  type BookingAvailabilityRecord,
  type CalendarCapabilityDraft,
  type CalendarCapabilityState,
  type CalendarEventDraft,
  type CalendarEventRecord,
} from '@/features/calendar';
import { toCalendarBookingPageAvailabilityConsumer } from '@/features/booking';

const range = { startUtc: '2026-07-20T00:00:00Z', endUtc: '2026-07-21T00:00:00Z' };

beforeEach(() => {
  canonical.commands = [];
  canonical.records = [];
  canonical.invoke.mockReset();
  canonical.invoke.mockImplementation((command, args) => {
    canonical.commands.push(command);
    if (command === 'crm_live_list') return Promise.resolve(structuredClone(canonical.records));
    if (command === 'crm_live_upsert' && args?.record) {
      const record = { ...structuredClone(args.record), canonicalReloadMarker: true } as LiveCrmRecord;
      const index = canonical.records.findIndex((candidate) => candidate.id === record.id);
      if (index >= 0) canonical.records[index] = record;
      else canonical.records.push(record);
      return Promise.resolve(args.record);
    }
    return Promise.reject(new Error(`Unexpected command ${command}`));
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CalendarBookingPublicPage fresh calendar read', () => {
  it('adapts fresh canonical settings and events through the public consumer after reload', async () => {
    const capability: CalendarCapabilityDraft = {
      calendars: [{ id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true }],
      homeCalendarId: 'calendar:local',
      busyCalendarIds: ['calendar:local'],
    };
    const availability: BookingAvailabilityDraft = {
      advisorTimezone: 'UTC',
      workingHours: {
        monday: [{ startLocal: '09:00', endLocal: '11:00' }],
        tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
      },
      meetingTypes: [{ id: 'Private meeting name', name: 'Private meeting name', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
      minimumNoticeMinutes: 0,
      maximumHorizonDays: 14,
    };
    const event: CalendarEventDraft = {
      title: 'Private client review',
      notes: 'Never public',
      startUtc: '2026-07-20T09:00:00Z',
      endUtc: '2026-07-20T09:30:00Z',
      displayTimezone: 'UTC',
      allDay: false,
      calendarId: 'calendar:local',
    };

    const eventWriter = renderHook(() => useCalendarEventStore());
    let savedEvent: CalendarEventRecord | undefined;
    try {
      const beforeInitialReload = eventWriter.result.current;
      await waitFor(() => {
        if (eventWriter.result.current === beforeInitialReload) {
          throw new Error('The calendar event store has not loaded its canonical records yet.');
        }
      });
      savedEvent = await eventWriter.result.current.create(event);
    } finally {
      eventWriter.unmount();
    }

    const capabilityWriter = renderHook(() => useCalendarCapabilityStore());
    let savedCapability: CalendarCapabilityState | undefined;
    try {
      savedCapability = await capabilityWriter.result.current.save(capability);
    } finally {
      capabilityWriter.unmount();
    }

    const availabilityWriter = renderHook(() => useBookingAvailabilityStore());
    let savedAvailability: BookingAvailabilityRecord | undefined;
    try {
      savedAvailability = await availabilityWriter.result.current.save(availability);
    } finally {
      availabilityWriter.unmount();
    }
    if (!savedEvent || !savedCapability || !savedAvailability) {
      throw new Error('Calendar writes did not return their canonical projections.');
    }

    const reader = renderHook(() => ({
      availability: useBookingAvailabilityStore(),
      capabilities: useCalendarCapabilityStore(),
      events: useCalendarEventStore(),
    }));
    try {
      let consumer: ReturnType<typeof toCalendarBookingPageAvailabilityConsumer> | undefined;
      await waitFor(async () => {
        const reloadedAvailability = await reader.result.current.availability.get();
        const reloadedCapability = await reader.result.current.capabilities.get();
        const reloadedEvent = await reader.result.current.events.get(savedEvent.id);
        if (!reloadedEvent || JSON.stringify(reloadedEvent) !== JSON.stringify(savedEvent)) {
          throw new Error('The saved calendar event has not reloaded with its fresh canonical projection.');
        }
        if (JSON.stringify(reloadedCapability) !== JSON.stringify(savedCapability)) {
          throw new Error('The saved calendar capability has not reloaded with its fresh canonical projection.');
        }
        if (JSON.stringify(reloadedAvailability) !== JSON.stringify(savedAvailability)) {
          throw new Error('The saved booking availability has not reloaded with its fresh canonical projection.');
        }
        consumer = toCalendarBookingPageAvailabilityConsumer({
          availability: reloadedAvailability,
          capability: reloadedCapability,
          occurrences: await reader.result.current.events.listOccurrences(range),
          nowUtc: '2026-07-19T00:00:00Z',
          range,
        });
        if (consumer.getPresentation().state !== 'available') throw new Error('Waiting for fresh display-ready slots.');
      });

      const presentation = consumer?.getPresentation();
      expect(presentation).toMatchObject({ state: 'available' });
      expect(JSON.stringify(presentation)).not.toContain('Private client review');
      expect(JSON.stringify(presentation)).not.toContain('Never public');
      expect(JSON.stringify(presentation)).not.toContain('Private meeting name');
      expect(canonical.commands).toContain('crm_live_list');
      expect(canonical.records.every((record) => record['canonicalReloadMarker'] === true)).toBe(true);
    } finally {
      reader.unmount();
    }
  });
});
