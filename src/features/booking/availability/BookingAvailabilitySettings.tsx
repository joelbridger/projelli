import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import {
  getBookableSlots,
  getBusyBlocks,
  useBookingAvailabilityStore,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  useCalendarSettingsStore,
  validateBookingAvailabilityDraft,
  validateCalendarCapabilityDraft,
  type BookingAvailabilityDraft,
  type CalendarBookableSlot,
  type CalendarCapabilityDraft,
  type CalendarLocalTimeRange,
  type CalendarMeetingType,
  type CalendarOccurrence,
  type CalendarRange,
  type CalendarSettingsStore,
  type CalendarWeekday,
  type OpaqueCalendarBusyBlock,
} from '@/features/calendar';

const WEEKDAYS: readonly CalendarWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function previewRange(): CalendarRange {
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1_000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

function toCapabilityDraft(
  value: CalendarCapabilityDraft
): CalendarCapabilityDraft {
  return {
    calendars: value.calendars,
    homeCalendarId: value.homeCalendarId,
    busyCalendarIds: value.busyCalendarIds,
  };
}

function toAvailabilityDraft(
  value: BookingAvailabilityDraft
): BookingAvailabilityDraft {
  return {
    advisorTimezone: value.advisorTimezone,
    workingHours: value.workingHours,
    meetingTypes: value.meetingTypes,
    minimumNoticeMinutes: value.minimumNoticeMinutes,
    maximumHorizonDays: value.maximumHorizonDays,
  };
}

function formatPreviewTime(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

type BusyTimeState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly occurrences: readonly CalendarOccurrence[];
    }
  | { readonly status: 'error' };

type PreviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'busy-error' }
  | { readonly status: 'draft-error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly busyBlocks: readonly OpaqueCalendarBusyBlock[];
      readonly slots: readonly CalendarBookableSlot[];
    };

async function saveCalendarSettingsAtomically(
  settingsStore: CalendarSettingsStore,
  capability: CalendarCapabilityDraft,
  availability: BookingAvailabilityDraft
): Promise<{
  readonly capability: CalendarCapabilityDraft;
  readonly availability: BookingAvailabilityDraft;
}> {
  // Both public validators run before the calendar foundation's one durable
  // aggregate write. There is no second writer and therefore no rollback path
  // that can fail halfway through this Save action.
  const checkedCapability = validateCalendarCapabilityDraft(capability);
  const checkedAvailability = validateBookingAvailabilityDraft(availability);
  const saved = await settingsStore.save({
    capability: checkedCapability,
    availability: checkedAvailability,
  });
  return {
    capability: toCapabilityDraft(saved.capability),
    availability: toAvailabilityDraft(saved.availability),
  };
}

/**
 * The outer guard must remain free of calendar hooks and calculations so a
 * dark flag leaves no settings-panel gap and does not load calendar records.
 */
export function BookingAvailabilitySettingsMount() {
  const enabled = useFlag('booking-availability');
  if (!enabled) return null;
  return <BookingAvailabilitySettings />;
}

/** Local settings and a preview only; no slot here becomes a hold or booking. */
export function BookingAvailabilitySettings() {
  const { t } = useTranslation();
  const capabilityStore = useCalendarCapabilityStore();
  const availabilityStore = useBookingAvailabilityStore();
  const settingsStore = useCalendarSettingsStore();
  const eventStore = useCalendarEventStore();
  const [capability, setCapability] = useState<CalendarCapabilityDraft>(() =>
    toCapabilityDraft(capabilityStore.state)
  );
  const [availability, setAvailability] = useState<BookingAvailabilityDraft>(
    () => toAvailabilityDraft(availabilityStore.availability)
  );
  const [busyTime, setBusyTime] = useState<BusyTimeState>({
    status: 'loading',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const range = useMemo(previewRange, []);
  const eventStoreRef = useRef(eventStore);
  eventStoreRef.current = eventStore;

  useEffect(() => {
    let active = true;
    eventStoreRef.current
      .listOccurrences(range)
      .then((next) => {
        if (!active) return;
        setBusyTime({ status: 'ready', occurrences: next });
      })
      .catch((_error: unknown) => {
        if (!active) return;
        setBusyTime({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [range]);

  const preview = useMemo<PreviewState>(() => {
    if (busyTime.status === 'loading') return { status: 'loading' };
    if (busyTime.status === 'error') return { status: 'busy-error' };
    try {
      const checkedCapability = validateCalendarCapabilityDraft(capability);
      const checkedAvailability =
        validateBookingAvailabilityDraft(availability);
      const busyBlocks = getBusyBlocks(range, {
        capability: {
          ...capabilityStore.state,
          ...checkedCapability,
        },
        localOccurrences: busyTime.occurrences,
      });
      const slots = getBookableSlots({
        availability: {
          ...availabilityStore.availability,
          ...checkedAvailability,
        },
        range,
        busyBlocks,
      });
      return { status: 'ready', busyBlocks, slots };
    } catch (error) {
      return {
        status: 'draft-error',
        message:
          error instanceof Error
            ? error.message
            : t('booking-availability.save-failed'),
      };
    }
  }, [
    availability,
    availabilityStore.availability,
    busyTime,
    capability,
    capabilityStore.state,
    range,
    t,
  ]);

  const updateHours = (
    weekday: CalendarWeekday,
    index: number,
    patch: Partial<CalendarLocalTimeRange>
  ) => {
    setAvailability((current) => ({
      ...current,
      workingHours: {
        ...current.workingHours,
        [weekday]: current.workingHours[weekday].map((window, windowIndex) =>
          windowIndex === index ? { ...window, ...patch } : window
        ),
      },
    }));
  };

  const addHours = (weekday: CalendarWeekday) => {
    setAvailability((current) => ({
      ...current,
      workingHours: {
        ...current.workingHours,
        [weekday]: [
          ...current.workingHours[weekday],
          { startLocal: '09:00', endLocal: '17:00' },
        ],
      },
    }));
  };

  const removeHours = (weekday: CalendarWeekday, index: number) => {
    setAvailability((current) => ({
      ...current,
      workingHours: {
        ...current.workingHours,
        [weekday]: current.workingHours[weekday].filter(
          (_, windowIndex) => windowIndex !== index
        ),
      },
    }));
  };

  const updateMeetingType = (
    index: number,
    patch: Partial<CalendarMeetingType>
  ) => {
    setAvailability((current) => ({
      ...current,
      meetingTypes: current.meetingTypes.map((meetingType, meetingTypeIndex) =>
        meetingTypeIndex === index ? { ...meetingType, ...patch } : meetingType
      ),
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveCalendarSettingsAtomically(
        settingsStore,
        capability,
        availability
      );
      setCapability(saved.capability);
      setAvailability(saved.availability);
      setMessage(t('booking-availability.saved'));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t('booking-availability.save-failed')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="booking-availability-settings"
      style={{ display: 'grid', gap: 'var(--kp-space-md)', maxWidth: 880 }}
    >
      <header>
        <h2 style={{ margin: 0 }}>{t('booking-availability.title')}</h2>
        <p style={muted}>{t('booking-availability.description')}</p>
      </header>

      {message && (
        <p role="status" data-testid="booking-availability-status">
          {message}
        </p>
      )}

      <div style={panel}>
        <h3 style={{ marginTop: 0 }}>
          {t('booking-availability.calendar-title')}
        </h3>
        <p style={muted}>{t('booking-availability.calendar-description')}</p>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('booking-availability.home-calendar')}
          <select
            data-testid="booking-availability-home-calendar"
            value={capability.homeCalendarId}
            onChange={(event) => {
              setCapability((current) => ({
                ...current,
                homeCalendarId: event.target.value,
              }));
            }}
          >
            {capability.calendars
              .filter((calendar) => calendar.ownership === 'local')
              .map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.label}
                </option>
              ))}
          </select>
        </label>
        <fieldset
          style={{ border: 0, margin: 'var(--kp-space-md) 0 0', padding: 0 }}
        >
          <legend>{t('booking-availability.busy-calendars')}</legend>
          <p style={muted}>{t('booking-availability.busy-calendars-help')}</p>
          {capability.calendars.map((calendar) => (
            <label
              key={calendar.id}
              style={{ display: 'flex', gap: 8, marginTop: 8 }}
            >
              <input
                checked={capability.busyCalendarIds.includes(calendar.id)}
                data-testid={`booking-availability-busy-calendar-${calendar.id}`}
                disabled={!calendar.canBlockBusyTime}
                type="checkbox"
                onChange={(event) => {
                  setCapability((current) => ({
                    ...current,
                    busyCalendarIds: event.target.checked
                      ? [...current.busyCalendarIds, calendar.id]
                      : current.busyCalendarIds.filter(
                          (id) => id !== calendar.id
                        ),
                  }));
                }}
              />
              {calendar.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div style={panel}>
        <h3 style={{ marginTop: 0 }}>
          {t('booking-availability.availability-title')}
        </h3>
        <label style={{ display: 'grid', gap: 4 }}>
          {t('booking-availability.timezone')}
          <input
            data-testid="booking-availability-timezone"
            value={availability.advisorTimezone}
            onChange={(event) => {
              setAvailability((current) => ({
                ...current,
                advisorTimezone: event.target.value,
              }));
            }}
          />
        </label>
        <div
          style={{ display: 'grid', gap: 12, marginTop: 'var(--kp-space-md)' }}
        >
          <h4 style={{ margin: 0 }}>
            {t('booking-availability.working-hours')}
          </h4>
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              data-testid={`booking-availability-hours-${weekday}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                paddingTop: 10,
              }}
            >
              <strong>{t(`booking-availability.weekdays.${weekday}`)}</strong>
              {availability.workingHours[weekday].map((window, index) => (
                <div
                  key={`${weekday}-${String(index)}`}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  <input
                    aria-label={t('booking-availability.start-time', {
                      weekday: t(`booking-availability.weekdays.${weekday}`),
                    })}
                    type="time"
                    value={window.startLocal}
                    onChange={(event) => {
                      updateHours(weekday, index, {
                        startLocal: event.target.value,
                      });
                    }}
                  />
                  <input
                    aria-label={t('booking-availability.end-time', {
                      weekday: t(`booking-availability.weekdays.${weekday}`),
                    })}
                    type="time"
                    value={window.endLocal}
                    onChange={(event) => {
                      updateHours(weekday, index, {
                        endLocal: event.target.value,
                      });
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      removeHours(weekday, index);
                    }}
                  >
                    {t('booking-availability.remove')}
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  addHours(weekday);
                }}
              >
                {t('booking-availability.add-hours')}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div style={panel}>
        <h3 style={{ marginTop: 0 }}>
          {t('booking-availability.meeting-types')}
        </h3>
        {availability.meetingTypes.map((meetingType, index) => (
          <div
            key={meetingType.id}
            data-testid={`booking-availability-meeting-type-${meetingType.id}`}
            style={{
              display: 'grid',
              gap: 8,
              borderTop: '1px solid var(--kp-border)',
              marginTop: 10,
              paddingTop: 10,
            }}
          >
            <label>
              {t('booking-availability.meeting-name')}
              <input
                value={meetingType.name}
                onChange={(event) => {
                  updateMeetingType(index, { name: event.target.value });
                }}
              />
            </label>
            <label>
              {t('booking-availability.duration')}
              <input
                min="5"
                type="number"
                value={meetingType.durationMinutes}
                onChange={(event) => {
                  updateMeetingType(index, {
                    durationMinutes: Number(event.target.value),
                  });
                }}
              />
            </label>
            <label>
              {t('booking-availability.buffer-before')}
              <input
                min="0"
                type="number"
                value={meetingType.bufferBeforeMinutes}
                onChange={(event) => {
                  updateMeetingType(index, {
                    bufferBeforeMinutes: Number(event.target.value),
                  });
                }}
              />
            </label>
            <label>
              {t('booking-availability.buffer-after')}
              <input
                min="0"
                type="number"
                value={meetingType.bufferAfterMinutes}
                onChange={(event) => {
                  updateMeetingType(index, {
                    bufferAfterMinutes: Number(event.target.value),
                  });
                }}
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAvailability((current) => ({
                  ...current,
                  meetingTypes: current.meetingTypes.filter(
                    (_, meetingTypeIndex) => meetingTypeIndex !== index
                  ),
                }));
              }}
            >
              {t('booking-availability.remove')}
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          style={{ marginTop: 10 }}
          onClick={() => {
            setAvailability((current) => ({
              ...current,
              meetingTypes: [
                ...current.meetingTypes,
                {
                  id: `meeting-${String(current.meetingTypes.length + 1)}`,
                  name: t('booking-availability.new-meeting'),
                  durationMinutes: 30,
                  bufferBeforeMinutes: 0,
                  bufferAfterMinutes: 0,
                },
              ],
            }));
          }}
        >
          {t('booking-availability.add-meeting')}
        </Button>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 'var(--kp-space-md)',
          }}
        >
          <label>
            {t('booking-availability.minimum-notice')}
            <input
              data-testid="booking-availability-minimum-notice"
              min="0"
              type="number"
              value={availability.minimumNoticeMinutes}
              onChange={(event) => {
                setAvailability((current) => ({
                  ...current,
                  minimumNoticeMinutes: Number(event.target.value),
                }));
              }}
            />
          </label>
          <label>
            {t('booking-availability.maximum-horizon')}
            <input
              data-testid="booking-availability-maximum-horizon"
              min="1"
              type="number"
              value={availability.maximumHorizonDays}
              onChange={(event) => {
                setAvailability((current) => ({
                  ...current,
                  maximumHorizonDays: Number(event.target.value),
                }));
              }}
            />
          </label>
        </div>
      </div>

      <div style={panel} data-testid="booking-availability-preview">
        <h3 style={{ marginTop: 0 }}>
          {t('booking-availability.preview-title')}
        </h3>
        <p data-testid="booking-availability-no-booking" style={muted}>
          {t('booking-availability.preview-safety')}
        </p>
        <h4>{t('booking-availability.busy-preview')}</h4>
        {preview.status === 'loading' ? (
          <p>{t('booking-availability.loading-busy')}</p>
        ) : preview.status === 'busy-error' ? (
          <p role="alert" data-testid="booking-availability-busy-error">
            {t('booking-availability.busy-unavailable')}
          </p>
        ) : preview.status === 'draft-error' ? (
          <p role="alert" data-testid="booking-availability-draft-error">
            {preview.message}
          </p>
        ) : preview.busyBlocks.length === 0 ? (
          <p>{t('booking-availability.no-busy')}</p>
        ) : (
          <ul>
            {preview.busyBlocks.map((block) => (
              <li
                data-testid="booking-availability-busy-block"
                key={`${block.calendarId}-${block.startUtc}`}
              >
                {formatPreviewTime(
                  block.startUtc,
                  availability.advisorTimezone
                )}{' '}
                –{' '}
                {formatPreviewTime(block.endUtc, availability.advisorTimezone)}
              </li>
            ))}
          </ul>
        )}
        <h4>{t('booking-availability.slot-preview')}</h4>
        {preview.status !== 'ready' ? (
          <p data-testid="booking-availability-slots-unavailable">
            {t('booking-availability.slots-unavailable')}
          </p>
        ) : preview.slots.length === 0 ? (
          <p>{t('booking-availability.no-slots')}</p>
        ) : (
          <ul>
            {preview.slots.slice(0, 12).map((slot) => (
              <li data-testid="booking-availability-slot" key={slot.id}>
                {formatPreviewTime(slot.startUtc, availability.advisorTimezone)}{' '}
                – {formatPreviewTime(slot.endUtc, availability.advisorTimezone)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <Button
          data-testid="booking-availability-save"
          loading={saving}
          onClick={() => {
            save().catch((error: unknown) => {
              setMessage(
                error instanceof Error
                  ? error.message
                  : t('booking-availability.save-failed')
              );
              setSaving(false);
            });
          }}
        >
          {t('booking-availability.save')}
        </Button>
      </div>
    </section>
  );
}
