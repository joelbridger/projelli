import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { loadLiveCrmRecords, type LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  CALENDAR_WEEKDAYS,
  type BookingAvailabilityDraft,
  type BookingAvailabilityRecord,
  type BookingAvailabilityStore,
  type CalendarCapabilityDraft,
  type CalendarCapabilityState,
  type CalendarCapabilityStore,
  type CalendarDescriptor,
  type CalendarMeetingType,
  type CalendarWorkingHours,
} from './types';
import { validateLocalTime, validateTimeZone } from './time';
import { CalendarFoundationError } from './errors';

const ADVISOR_ID = 'local-user';
const LOCAL_CALENDAR_ID = 'calendar:local';
const CAPABILITY_RECORD_ID = `calendar-capability:${ADVISOR_ID}`;
const AVAILABILITY_RECORD_ID = `booking-availability:${ADVISOR_ID}`;

type CalendarSettingsPort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save'
> & {
  reloadRecords(): Promise<readonly LiveCrmRecord[] | undefined>;
};

function actor() {
  return { userId: ADVISOR_ID, display: 'You', kind: 'user' as const };
}

function now(): string {
  return new Date().toISOString();
}

function requireAvailable(port: CalendarSettingsPort): void {
  if (!port.workspaceRoot) throw new Error('Open a workspace before changing calendar settings.');
  if (port.error) throw new Error('Calendar settings are unavailable until CRM records reload.');
}

function defaultLocalCalendar(): CalendarDescriptor {
  return {
    id: LOCAL_CALENDAR_ID,
    label: 'My calendar',
    ownership: 'local',
    canBlockBusyTime: true,
  };
}

export function defaultCalendarCapabilityState(): CalendarCapabilityState {
  return {
    scope: 'active-workspace-advisor',
    advisorId: ADVISOR_ID,
    calendars: [defaultLocalCalendar()],
    homeCalendarId: LOCAL_CALENDAR_ID,
    busyCalendarIds: [LOCAL_CALENDAR_ID],
  };
}

function cleanCalendarDescriptor(value: CalendarDescriptor): CalendarDescriptor {
  const id = value.id.trim();
  const label = value.label.trim();
  if (!id || id !== value.id || !label) throw new Error('Calendar declarations require stable IDs and labels.');
  const ownership: unknown = value.ownership;
  if (ownership !== 'local' && ownership !== 'external-read-only') {
    throw new Error('Calendar ownership declaration is invalid.');
  }
  return { id, label, ownership: value.ownership, canBlockBusyTime: value.canBlockBusyTime };
}

export function validateCalendarCapabilityDraft(value: CalendarCapabilityDraft): CalendarCapabilityDraft {
  const calendars = value.calendars.map(cleanCalendarDescriptor);
  if (new Set(calendars.map((calendar) => calendar.id)).size !== calendars.length) {
    throw new Error('Calendar IDs must not be duplicated.');
  }
  if (!calendars.some((calendar) => calendar.id === LOCAL_CALENDAR_ID && calendar.ownership === 'local')) {
    throw new Error('The stable local calendar cannot be removed.');
  }
  const home = calendars.find((calendar) => calendar.id === value.homeCalendarId);
  if (!home || home.ownership !== 'local') {
    throw new Error('Exactly one declared local calendar must be selected as home.');
  }
  if (new Set(value.busyCalendarIds).size !== value.busyCalendarIds.length) {
    throw new Error('Busy-blocking calendar IDs must not be duplicated.');
  }
  for (const id of value.busyCalendarIds) {
    const calendar = calendars.find((candidate) => candidate.id === id);
    if (!calendar?.canBlockBusyTime) throw new Error('A selected busy calendar does not declare busy-time capability.');
  }
  return { calendars, homeCalendarId: home.id, busyCalendarIds: [...value.busyCalendarIds] };
}

function storedCapability(record: LiveCrmRecord | undefined): CalendarCapabilityState {
  const fallback = defaultCalendarCapabilityState();
  if (!record) return fallback;
  try {
    const rawCalendars = Array.isArray(record['calendars']) ? record['calendars'] as CalendarDescriptor[] : [];
    const calendars = rawCalendars.some((calendar) => calendar.id === LOCAL_CALENDAR_ID)
      ? rawCalendars
      : [defaultLocalCalendar(), ...rawCalendars];
    const draft = validateCalendarCapabilityDraft({
      calendars,
      homeCalendarId: typeof record['homeCalendarId'] === 'string' ? record['homeCalendarId'] : LOCAL_CALENDAR_ID,
      busyCalendarIds: Array.isArray(record['busyCalendarIds'])
        ? record['busyCalendarIds'].filter((id): id is string => typeof id === 'string')
        : [LOCAL_CALENDAR_ID],
    });
    return { scope: 'active-workspace-advisor', advisorId: ADVISOR_ID, ...draft };
  } catch {
    return fallback;
  }
}

export function calendarCapabilityFromRecords(records: readonly LiveCrmRecord[]): CalendarCapabilityState {
  return storedCapability(records.find(
    (candidate) => candidate.id === CAPABILITY_RECORD_ID && candidate.kind === 'calendar_capability',
  ));
}

function capabilityRecord(draftInput: CalendarCapabilityDraft, existing?: LiveCrmRecord): LiveCrmRecord {
  const draft = validateCalendarCapabilityDraft(draftInput);
  const timestamp = now();
  return {
    ...existing,
    id: CAPABILITY_RECORD_ID,
    kind: 'calendar_capability',
    matterId: 'firm_home',
    createdAt: existing?.createdAt ?? timestamp,
    createdBy: existing?.['createdBy'] ?? actor(),
    updatedAt: timestamp,
    updatedBy: actor(),
    source: existing?.['source'] ?? { origin: 'user', sources: [] },
    deleted: false,
    schemaVersion: 1,
    scope: 'active-workspace-advisor',
    advisorId: ADVISOR_ID,
    calendars: draft.calendars,
    homeCalendarId: draft.homeCalendarId,
    busyCalendarIds: draft.busyCalendarIds,
  };
}

export function createCalendarCapabilityStore(port: CalendarSettingsPort): CalendarCapabilityStore {
  const record = port.records.find((candidate) => candidate.id === CAPABILITY_RECORD_ID && candidate.kind === 'calendar_capability');
  const state = calendarCapabilityFromRecords(port.records);
  const save = async (draft: CalendarCapabilityDraft): Promise<CalendarCapabilityState> => {
    requireAvailable(port);
    await port.save(capabilityRecord(draft, record));
    const reloaded = await port.reloadRecords();
    const canonical = reloaded?.find(
      (candidate) => candidate.id === CAPABILITY_RECORD_ID && candidate.kind === 'calendar_capability',
    );
    if (!canonical) {
      throw new CalendarFoundationError(
        'canonical_reload_missing',
        'The saved calendar capability was not present after the canonical reload.',
      );
    }
    return storedCapability(canonical);
  };
  return {
    state,
    error: port.error,
    get: () => Promise.resolve().then(() => {
      requireAvailable(port);
      return state;
    }),
    save,
    setSelection: (homeCalendarId, busyCalendarIds) => save({
      calendars: state.calendars,
      homeCalendarId,
      busyCalendarIds,
    }),
  };
}

export function useCalendarCapabilityStore(): CalendarCapabilityStore {
  const live = useLiveCrmRecords();
  return createCalendarCapabilityStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}

function emptyWorkingHours(): CalendarWorkingHours {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

export function defaultBookingAvailability(): BookingAvailabilityRecord {
  return {
    id: AVAILABILITY_RECORD_ID,
    kind: 'booking_availability',
    scope: 'active-workspace-advisor',
    advisorId: ADVISOR_ID,
    advisorTimezone: 'UTC',
    workingHours: emptyWorkingHours(),
    meetingTypes: [],
    minimumNoticeMinutes: 0,
    maximumHorizonDays: 30,
  };
}

function cleanMeetingType(value: CalendarMeetingType): CalendarMeetingType {
  const id = value.id.trim();
  const name = value.name.trim();
  if (!id || id !== value.id || !name) throw new Error('Meeting types require stable IDs and names.');
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 5 || value.durationMinutes > 1_440) {
    throw new Error('Meeting duration must be a whole number from 5 through 1440 minutes.');
  }
  for (const [label, minutes] of [
    ['Meeting buffer before', value.bufferBeforeMinutes],
    ['Meeting buffer after', value.bufferAfterMinutes],
  ] as const) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1_440) {
      throw new Error(`${label} must be a whole number from 0 through 1440 minutes.`);
    }
  }
  return { ...value, id, name };
}

export function validateBookingAvailabilityDraft(value: BookingAvailabilityDraft): BookingAvailabilityDraft {
  const advisorTimezone = validateTimeZone(value.advisorTimezone);
  const workingHours = {} as Record<(typeof CALENDAR_WEEKDAYS)[number], readonly { startLocal: string; endLocal: string }[]>;
  for (const weekday of CALENDAR_WEEKDAYS) {
    const intervals = value.workingHours[weekday];
    const checked = intervals.map((interval) => {
      const start = validateLocalTime(interval.startLocal, `${weekday} start`);
      const end = validateLocalTime(interval.endLocal, `${weekday} end`);
      if (end <= start) throw new Error(`${weekday} working hours must end after they start.`);
      return { interval: { startLocal: interval.startLocal, endLocal: interval.endLocal }, start, end };
    });
    const sorted = [...checked].sort((left, right) => left.start - right.start);
    if (sorted.some((interval, index) => index > 0 && interval.start < (sorted[index - 1]?.end ?? 0))) {
      throw new Error(`${weekday} working hours must not overlap.`);
    }
    workingHours[weekday] = checked.map(({ interval }) => interval);
  }
  const meetingTypes = value.meetingTypes.map(cleanMeetingType);
  if (new Set(meetingTypes.map((meetingType) => meetingType.id)).size !== meetingTypes.length) {
    throw new Error('Meeting type IDs must not be duplicated.');
  }
  if (!Number.isInteger(value.minimumNoticeMinutes) || value.minimumNoticeMinutes < 0 || value.minimumNoticeMinutes > 525_600) {
    throw new Error('Minimum notice must be a whole number from 0 through 525600 minutes.');
  }
  if (!Number.isInteger(value.maximumHorizonDays) || value.maximumHorizonDays < 1 || value.maximumHorizonDays > 370) {
    throw new Error('Maximum booking horizon must be a whole number from 1 through 370 days.');
  }
  return {
    advisorTimezone,
    workingHours,
    meetingTypes,
    minimumNoticeMinutes: value.minimumNoticeMinutes,
    maximumHorizonDays: value.maximumHorizonDays,
  };
}

function storedAvailability(record: LiveCrmRecord | undefined): BookingAvailabilityRecord {
  const fallback = defaultBookingAvailability();
  if (!record) return fallback;
  try {
    const draft = validateBookingAvailabilityDraft({
      advisorTimezone: typeof record['advisorTimezone'] === 'string' ? record['advisorTimezone'] : fallback.advisorTimezone,
      workingHours: record['workingHours'] as CalendarWorkingHours,
      meetingTypes: Array.isArray(record['meetingTypes']) ? record['meetingTypes'] as CalendarMeetingType[] : [],
      minimumNoticeMinutes: Number(record['minimumNoticeMinutes'] ?? 0),
      maximumHorizonDays: Number(record['maximumHorizonDays'] ?? 30),
    });
    return { id: AVAILABILITY_RECORD_ID, kind: 'booking_availability', scope: 'active-workspace-advisor', advisorId: ADVISOR_ID, ...draft };
  } catch {
    return fallback;
  }
}

function availabilityRecord(draftInput: BookingAvailabilityDraft, existing?: LiveCrmRecord): LiveCrmRecord {
  const draft = validateBookingAvailabilityDraft(draftInput);
  const timestamp = now();
  return {
    ...existing,
    id: AVAILABILITY_RECORD_ID,
    kind: 'booking_availability',
    matterId: 'firm_home',
    createdAt: existing?.createdAt ?? timestamp,
    createdBy: existing?.['createdBy'] ?? actor(),
    updatedAt: timestamp,
    updatedBy: actor(),
    source: existing?.['source'] ?? { origin: 'user', sources: [] },
    deleted: false,
    schemaVersion: 1,
    scope: 'active-workspace-advisor',
    advisorId: ADVISOR_ID,
    ...draft,
  };
}

export function createBookingAvailabilityStore(port: CalendarSettingsPort): BookingAvailabilityStore {
  const record = port.records.find((candidate) => candidate.id === AVAILABILITY_RECORD_ID && candidate.kind === 'booking_availability');
  const availability = storedAvailability(record);
  return {
    availability,
    error: port.error,
    get: () => Promise.resolve().then(() => {
      requireAvailable(port);
      return availability;
    }),
    save: async (draft) => {
      requireAvailable(port);
      await port.save(availabilityRecord(draft, record));
      const reloaded = await port.reloadRecords();
      const canonical = reloaded?.find(
        (candidate) => candidate.id === AVAILABILITY_RECORD_ID && candidate.kind === 'booking_availability',
      );
      if (!canonical) {
        throw new CalendarFoundationError(
          'canonical_reload_missing',
          'The saved booking availability was not present after the canonical reload.',
        );
      }
      return storedAvailability(canonical);
    },
  };
}

export function useBookingAvailabilityStore(): BookingAvailabilityStore {
  const live = useLiveCrmRecords();
  return createBookingAvailabilityStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
