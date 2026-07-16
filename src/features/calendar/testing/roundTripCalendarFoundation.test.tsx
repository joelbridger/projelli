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

import { CalendarFoundationError, useCalendarEventStore } from '@/features/calendar';
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
