import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => canonical.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
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
  CalendarFoundationError,
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  useCalendarSettingsStore,
} from '@/features/calendar';
import { roundTripCalendarEvent, roundTripCalendarFoundation } from '@/features/calendar/testing';

const baseEvent = {
  title: 'Save echo title',
  startUtc: '2026-08-03T14:00:00Z',
  endUtc: '2026-08-03T14:30:00Z',
  displayTimezone: 'America/New_York',
  allDay: false,
  calendarId: 'calendar:local',
} as const;

function capabilityRecord(calendars: readonly {
  id: string;
  label: string;
  ownership: 'local' | 'external-read-only';
  canBlockBusyTime: boolean;
}[]): LiveCrmRecord {
  return {
    id: 'calendar-capability:local-user',
    kind: 'calendar_capability',
    calendars,
    homeCalendarId: 'calendar:local',
    busyCalendarIds: ['calendar:local'],
  };
}

function legacyAvailabilityRecord(): LiveCrmRecord {
  return {
    id: 'booking-availability:local-user',
    kind: 'booking_availability',
    ...structuredClone(oldAvailability),
  };
}

const oldCapability = {
  calendars: [
    { id: 'calendar:local', label: 'My calendar', ownership: 'local' as const, canBlockBusyTime: true },
    { id: 'calendar:second', label: 'Second', ownership: 'local' as const, canBlockBusyTime: true },
  ],
  homeCalendarId: 'calendar:local',
  busyCalendarIds: ['calendar:local'],
};

const oldAvailability = {
  advisorTimezone: 'UTC',
  workingHours: {
    monday: [{ startLocal: '09:00', endLocal: '17:00' }],
    tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  },
  meetingTypes: [{ id: 'intro', name: 'Intro', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
  minimumNoticeMinutes: 30,
  maximumHorizonDays: 30,
};

function calendarSettingsRecord(): LiveCrmRecord {
  return {
    id: 'calendar-settings:local-user',
    kind: 'calendar_settings',
    matterId: 'firm_home',
    futureAggregateField: 'keep-me',
    capability: { ...structuredClone(oldCapability), futureCapabilityField: 'keep-me' },
    availability: { ...structuredClone(oldAvailability), futureAvailabilityField: 'keep-me' },
  };
}

const newCapability = {
  ...oldCapability,
  homeCalendarId: 'calendar:second',
  busyCalendarIds: ['calendar:local', 'calendar:second'],
};

const newAvailability = {
  ...oldAvailability,
  advisorTimezone: 'America/Chicago',
  maximumHorizonDays: 45,
};

async function expectCalendarFailure(
  promise: Promise<unknown>,
  code: 'calendar_not_found' | 'calendar_read_only',
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected calendar failure ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(CalendarFoundationError);
    expect(error).toMatchObject({ code });
  }
}

describe('roundTripCalendarFoundation', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.commands = [];
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(canonical.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const saveEcho = structuredClone(args.record);
        const stored: LiveCrmRecord = {
          ...saveEcho,
          canonicalReloadMarker: true,
          ...(saveEcho.kind === 'calendar_event' ? { notes: 'Loaded from crm_live_list' } : {}),
          ...(saveEcho.kind === 'calendar_capability'
            ? { calendars: (saveEcho['calendars'] as { id: string; label: string }[]).map((calendar) =>
                calendar.id === 'calendar:second' ? { ...calendar, label: 'Loaded home calendar' } : calendar) }
            : {}),
          ...(saveEcho.kind === 'booking_availability'
            ? { meetingTypes: [{ id: 'intro', name: 'Loaded meeting type', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }] }
            : {}),
          ...(saveEcho.kind === 'calendar_settings'
            ? {
                capability: {
                  ...(saveEcho['capability'] as Record<string, unknown>),
                  calendars: ((saveEcho['capability'] as Record<string, unknown>)['calendars'] as { id: string; label: string }[])
                    .map((calendar) => calendar.id === 'calendar:second'
                      ? { ...calendar, label: 'Loaded home calendar' }
                      : calendar),
                },
                availability: {
                  ...(saveEcho['availability'] as Record<string, unknown>),
                  meetingTypes: [{ id: 'intro', name: 'Loaded meeting type', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
                },
              }
            : {}),
        };
        const index = canonical.records.findIndex((item) => item.id === stored.id);
        if (index >= 0) canonical.records[index] = stored;
        else canonical.records.push(stored);
        return Promise.resolve(saveEcho);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the canonical list value from the write itself and confirms it through a fresh reader', async () => {
    const oneTime = await roundTripCalendarEvent(baseEvent);
    expect(oneTime.notes).toBe('Loaded from crm_live_list');

    const recurring = await roundTripCalendarEvent({
      ...baseEvent,
      title: 'Recurring review',
      recurrence: { frequency: 'monthly', interval: 1, count: 6 },
    });
    expect(recurring.recurrence).toMatchObject({ frequency: 'monthly', count: 6 });
    expect(recurring.seriesId).toBe(recurring.id);

    const recordDerived = await roundTripCalendarEvent({
      ...baseEvent,
      title: 'Rivera review',
      contextRef: { kind: 'household', id: 'household-1', matterId: 'matter-1', label: 'Rivera' },
    });
    expect(recordDerived.contextRef).toMatchObject({ id: 'household-1', matterId: 'matter-1' });
    const lastUpsert = canonical.commands.lastIndexOf('crm_live_upsert');
    expect(lastUpsert).toBeGreaterThanOrEqual(0);
    expect(canonical.commands.slice(lastUpsert + 1)).toContain('crm_live_list');
  });

  it('round-trips home-calendar selection and advisor availability through canonical reload', async () => {
    const result = await roundTripCalendarFoundation({
      capability: {
        calendars: [
          { id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true },
          { id: 'calendar:second', label: 'Second', ownership: 'local', canBlockBusyTime: true },
        ],
        homeCalendarId: 'calendar:second',
        busyCalendarIds: ['calendar:local', 'calendar:second'],
      },
      availability: {
        advisorTimezone: 'America/Chicago',
        workingHours: {
          monday: [{ startLocal: '09:00', endLocal: '17:00' }],
          tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
        },
        meetingTypes: [{ id: 'intro', name: 'Save echo', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
        minimumNoticeMinutes: 120,
        maximumHorizonDays: 45,
      },
    });
    expect(result.capability).toMatchObject({ homeCalendarId: 'calendar:second' });
    expect(result.capability?.calendars.find((calendar) => calendar.id === 'calendar:second')?.label).toBe('Loaded home calendar');
    expect(result.availability).toMatchObject({ advisorTimezone: 'America/Chicago', maximumHorizonDays: 45 });
    expect(result.availability?.meetingTypes[0]?.name).toBe('Loaded meeting type');
    const settingsUpserts = canonical.commands.filter((command) => command === 'crm_live_upsert');
    expect(settingsUpserts).toHaveLength(1);
  });

  it('keeps a failed aggregate writer failing and leaves exact prior settings for a fresh reader', async () => {
    canonical.records = [calendarSettingsRecord()];
    const before = structuredClone(canonical.records);
    const failSettingsWrite = vi.fn(() =>
      Promise.reject(new Error('Calendar settings transaction failed.'))
    );
    const attemptedRecords: LiveCrmRecord[] = [];
    canonical.invoke.mockReset().mockImplementation((command, args) => {
      canonical.commands.push(command);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonical.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        attemptedRecords.push(structuredClone(args.record));
        if (args.record.kind === 'calendar_settings') {
          return failSettingsWrite();
        }
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });

    const writer = renderHook(() => useCalendarSettingsStore());
    await waitFor(async () => {
      const current = await writer.result.current.get();
      if (current.capability.calendars.length !== oldCapability.calendars.length) {
        throw new Error('Waiting for the original settings aggregate.');
      }
    });
    await expect(writer.result.current.save({
      capability: newCapability,
      availability: newAvailability,
    })).rejects.toThrow('Calendar settings transaction failed.');
    writer.unmount();

    const reader = renderHook(() => useCalendarSettingsStore());
    let reloaded = await reader.result.current.get();
    await waitFor(async () => {
      reloaded = await reader.result.current.get();
      if (reloaded.capability.calendars.length !== oldCapability.calendars.length) {
        throw new Error('Waiting for a fresh read of the original settings.');
      }
    });
    reader.unmount();

    expect(failSettingsWrite).toHaveBeenCalledOnce();
    expect(attemptedRecords).toHaveLength(1);
    expect(attemptedRecords[0]).toMatchObject({
      kind: 'calendar_settings',
      capability: newCapability,
      availability: newAvailability,
    });
    expect(attemptedRecords.some((record) => record.kind === 'calendar_capability')).toBe(false);
    expect(attemptedRecords.some((record) => record.kind === 'booking_availability')).toBe(false);
    expect(canonical.records).toEqual(before);
    expect(reloaded).toEqual({
      capability: {
        scope: 'active-workspace-advisor',
        advisorId: 'local-user',
        ...oldCapability,
      },
      availability: {
        id: 'booking-availability:local-user',
        kind: 'booking_availability',
        scope: 'active-workspace-advisor',
        advisorId: 'local-user',
        ...oldAvailability,
      },
    });
    expect(JSON.stringify(canonical.records)).not.toContain('America/Chicago');
  });

  it('merges stale one-setting writers without losing the other saved half', async () => {
    canonical.records = [calendarSettingsRecord()];
    const writers = renderHook(() => ({
      capability: useCalendarCapabilityStore(),
      availability: useBookingAvailabilityStore(),
    }));
    await waitFor(() => {
      if (writers.result.current.capability.state.calendars.length < 2) {
        throw new Error('Waiting for the original aggregate.');
      }
    });

    const staleCapabilityWriter = writers.result.current.capability;
    const staleAvailabilityWriter = writers.result.current.availability;
    await Promise.all([
      staleCapabilityWriter.save(newCapability),
      staleAvailabilityWriter.save(newAvailability),
    ]);
    writers.unmount();

    const reader = renderHook(() => useCalendarSettingsStore());
    let reloaded = await reader.result.current.get();
    await waitFor(async () => {
      reloaded = await reader.result.current.get();
      if (
        reloaded.capability.homeCalendarId !== 'calendar:second'
        || reloaded.availability.advisorTimezone !== 'America/Chicago'
      ) {
        throw new Error('Waiting for both settings halves to reload.');
      }
    });
    reader.unmount();

    expect(reloaded.capability.homeCalendarId).toBe('calendar:second');
    expect(reloaded.availability.advisorTimezone).toBe('America/Chicago');
    expect(canonical.records[0]).toMatchObject({
      futureAggregateField: 'keep-me',
      capability: { futureCapabilityField: 'keep-me' },
      availability: { futureAvailabilityField: 'keep-me' },
    });
  });

  it('migrates legacy split settings into one aggregate without losing either half', async () => {
    canonical.records = [
      capabilityRecord(oldCapability.calendars),
      legacyAvailabilityRecord(),
    ];
    const attemptedRecords: LiveCrmRecord[] = [];
    const originalInvoke = canonical.invoke.getMockImplementation();
    canonical.invoke.mockImplementation(async (command, args) => {
      if (command === 'crm_live_upsert' && args?.record) {
        attemptedRecords.push(structuredClone(args.record));
      }
      if (!originalInvoke) throw new Error('Missing canonical persistence mock.');
      return originalInvoke(command, args);
    });

    const writer = renderHook(() => useCalendarCapabilityStore());
    await waitFor(() => {
      if (writer.result.current.state.calendars.length !== oldCapability.calendars.length) {
        throw new Error('Waiting for both legacy settings records.');
      }
    });
    await writer.result.current.save(newCapability);
    writer.unmount();

    expect(attemptedRecords).toHaveLength(1);
    expect(attemptedRecords[0]).toMatchObject({
      kind: 'calendar_settings',
      capability: newCapability,
      availability: oldAvailability,
    });

    const reader = renderHook(() => useCalendarSettingsStore());
    let reloaded = await reader.result.current.get();
    await waitFor(async () => {
      reloaded = await reader.result.current.get();
      if (reloaded.capability.homeCalendarId !== 'calendar:second') {
        throw new Error('Waiting for the migrated aggregate.');
      }
    });
    reader.unmount();

    expect(reloaded.capability).toMatchObject({
      homeCalendarId: 'calendar:second',
      busyCalendarIds: ['calendar:local', 'calendar:second'],
    });
    expect(reloaded.availability).toMatchObject({
      advisorTimezone: oldAvailability.advisorTimezone,
      workingHours: oldAvailability.workingHours,
      minimumNoticeMinutes: oldAvailability.minimumNoticeMinutes,
      maximumHorizonDays: oldAvailability.maximumHorizonDays,
    });
  });

  it('exposes each settings writer return so a pre-reload save echo fails the round trip', async () => {
    const result = await roundTripCalendarFoundation({
      capability: {
        calendars: [
          { id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true },
          { id: 'calendar:second', label: 'Save echo label', ownership: 'local', canBlockBusyTime: true },
        ],
        homeCalendarId: 'calendar:second',
        busyCalendarIds: ['calendar:local', 'calendar:second'],
      },
      availability: {
        advisorTimezone: 'America/Chicago',
        workingHours: {
          monday: [{ startLocal: '09:00', endLocal: '17:00' }],
          tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
        },
        meetingTypes: [{ id: 'intro', name: 'Save echo', durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }],
        minimumNoticeMinutes: 120,
        maximumHorizonDays: 45,
      },
    });

    expect(result.capability?.calendars.find((calendar) => calendar.id === 'calendar:second')?.label)
      .toBe('Loaded home calendar');
    expect(result.availability?.meetingTypes[0]?.name).toBe('Loaded meeting type');
  });

  it('keeps context and additive fields through a thin update and another fresh reload', async () => {
    const created = await roundTripCalendarEvent({
      ...baseEvent,
      contextRef: { kind: 'household', id: 'household-2', matterId: 'matter-2' },
    });
    const editor = renderHook(() => useCalendarEventStore());
    await waitFor(async () => {
      if (!await editor.result.current.get(created.id)) throw new Error('Waiting for the editor reload.');
    });
    const updated = await editor.result.current.update(created.id, { title: 'Thin title patch' });
    editor.unmount();
    expect(updated.notes).toBe('Loaded from crm_live_list');

    const reader = renderHook(() => useCalendarEventStore());
    let reloaded = undefined as Awaited<ReturnType<typeof reader.result.current.get>>;
    await waitFor(async () => {
      reloaded = await reader.result.current.get(created.id);
      if (!reloaded || reloaded.title !== 'Thin title patch') throw new Error('Waiting for the patched reload.');
    });
    reader.unmount();
    expect(reloaded?.contextRef).toMatchObject({ id: 'household-2', matterId: 'matter-2' });
    expect(canonical.records.find((record) => record.id === created.id)?.['canonicalReloadMarker']).toBe(true);
  });

  it('rejects an unknown calendar ID through the public event harness', async () => {
    await expectCalendarFailure(
      roundTripCalendarEvent({ ...baseEvent, calendarId: 'calendar:missing' }),
      'calendar_not_found',
    );
    expect(canonical.commands).not.toContain('crm_live_upsert');
  });

  it('rejects an external read-only calendar through the public event harness', async () => {
    canonical.records = [capabilityRecord([
      { id: 'calendar:local', label: 'My calendar', ownership: 'local', canBlockBusyTime: true },
      { id: 'calendar:external', label: 'External', ownership: 'external-read-only', canBlockBusyTime: true },
    ])];
    await expectCalendarFailure(
      roundTripCalendarEvent({ ...baseEvent, calendarId: 'calendar:external' }),
      'calendar_read_only',
    );
    expect(canonical.commands).not.toContain('crm_live_upsert');
  });
});
