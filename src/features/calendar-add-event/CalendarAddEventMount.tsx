import { useMemo, useState, type FormEvent } from 'react';
import { CalendarPlus, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import {
  CalendarFoundationError,
  useCalendarCapabilityStore,
  useCalendarEventStore,
  validateCalendarEventDraft,
  validateCalendarRecurrence,
  type CalendarEventDraft,
  type CalendarEventRecord,
  type CalendarRecurrenceRule,
  type CalendarWeekday,
} from '@/features/calendar';
import { Button, Card } from '@/ui/kp';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';

type RecurrenceFrequency = 'none' | CalendarRecurrenceRule['frequency'];

interface EventForm {
  title: string;
  notes: string;
  startUtc: string;
  endUtc: string;
  displayTimezone: string;
  allDay: boolean;
  calendarId: string;
  frequency: RecurrenceFrequency;
  interval: string;
  count: string;
  weekdays: readonly CalendarWeekday[];
  monthDays: string;
}

const WEEKDAYS: readonly CalendarWeekday[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

function utcInputValue(value: string): string {
  return value.replace(/Z$/, '').slice(0, 16);
}

function utcNowInputValue(minutesFromNow: number): string {
  return utcInputValue(new Date(Date.now() + minutesFromNow * 60_000).toISOString());
}

function utcFromInput(value: string): string {
  return `${value}:00Z`;
}

function newForm(calendarId: string): EventForm {
  return {
    title: '', notes: '', startUtc: utcNowInputValue(60), endUtc: utcNowInputValue(90),
    displayTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    allDay: false, calendarId, frequency: 'none', interval: '1', count: '', weekdays: [], monthDays: '',
  };
}

function formFromEvent(event: CalendarEventRecord): EventForm {
  return {
    title: event.title, notes: event.notes ?? '', startUtc: utcInputValue(event.startUtc), endUtc: utcInputValue(event.endUtc),
    displayTimezone: event.displayTimezone, allDay: event.allDay, calendarId: event.calendarId,
    frequency: event.recurrence?.frequency ?? 'none', interval: String(event.recurrence?.interval ?? 1),
    count: event.recurrence?.count === undefined ? '' : String(event.recurrence.count),
    weekdays: event.recurrence?.byWeekday ?? [], monthDays: event.recurrence?.byMonthDay?.join(', ') ?? '',
  };
}

function recurrenceFromForm(form: EventForm): CalendarRecurrenceRule | undefined {
  if (form.frequency === 'none') return undefined;
  const monthDays = form.monthDays.trim() === ''
    ? undefined
    : form.monthDays.split(',').map((value) => Number(value.trim()));
  const count = form.count.trim() === '' ? undefined : Number(form.count);
  const rule: CalendarRecurrenceRule = {
    frequency: form.frequency,
    interval: Number(form.interval),
    ...(count === undefined ? {} : { count }),
    ...(form.weekdays.length === 0 ? {} : { byWeekday: form.weekdays }),
    ...(monthDays === undefined ? {} : { byMonthDay: monthDays }),
  };
  return validateCalendarRecurrence(rule, utcFromInput(form.startUtc));
}

function draftFromForm(form: EventForm): CalendarEventDraft {
  const recurrence = recurrenceFromForm(form);
  return validateCalendarEventDraft({
    title: form.title,
    ...(form.notes.trim() === '' ? {} : { notes: form.notes }),
    startUtc: utcFromInput(form.startUtc),
    endUtc: utcFromInput(form.endUtc),
    displayTimezone: form.displayTimezone,
    allDay: form.allDay,
    calendarId: form.calendarId,
    ...(recurrence ? { recurrence } : {}),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof CalendarFoundationError) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : 'The calendar event could not be saved.';
}

/** The enabled child is the first place calendar stores and form state are read. */
function EnabledCalendarAddEventMount() {
  const { t } = useTranslation();
  const events = useCalendarEventStore();
  const capability = useCalendarCapabilityStore();
  const localCalendars = useMemo(
    () => capability.state.calendars.filter((calendar) => calendar.ownership === 'local'),
    [capability.state.calendars],
  );
  const [editing, setEditing] = useState<CalendarEventRecord | null>(null);
  const [form, setForm] = useState<EventForm>(() => newForm(capability.state.homeCalendarId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const update = (changes: Partial<EventForm>) => { setForm((current) => ({ ...current, ...changes })); };
  const startNew = () => {
    setEditing(null);
    setForm(newForm(capability.state.homeCalendarId));
    setError(null);
    setSavedId(null);
  };
  const startEdit = (event: CalendarEventRecord) => {
    setEditing(event);
    setForm(formFromEvent(event));
    setError(null);
    setSavedId(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSavedId(null);
    try {
      const draft = draftFromForm(form);
      const saved = editing
        ? await events.update(editing.id, {
          title: draft.title,
          notes: draft.notes ?? null,
          startUtc: draft.startUtc,
          endUtc: draft.endUtc,
          displayTimezone: draft.displayTimezone,
          allDay: draft.allDay,
          recurrence: draft.recurrence ?? null,
        })
        : await events.create(draft);
      setSavedId(saved.id);
      setEditing(saved);
      setForm(formFromEvent(saved));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const cancel = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const cancelled = await events.cancel(editing.id);
      setSavedId(cancelled.id);
      setEditing(cancelled);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const toggleWeekday = (weekday: CalendarWeekday) => {
    update({ weekdays: form.weekdays.includes(weekday)
      ? form.weekdays.filter((value) => value !== weekday)
      : [...form.weekdays, weekday] });
  };

  return (
    <section data-testid="calendar-add-event-mount" style={{ display: 'grid', gap: 'var(--kp-space-4)' }}>
      <Card variant="raised" data-testid="calendar-add-event-editor">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-3)', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>{editing ? t('calendar-add-event.edit-title') : t('calendar-add-event.title')}</h2>
            <p style={{ margin: 'var(--kp-space-1) 0 0' }}>{t('calendar-add-event.description')}</p>
          </div>
          {editing ? <Button variant="secondary" onClick={startNew}>{t('calendar-add-event.new')}</Button> : null}
        </div>
        {localCalendars.length === 0 ? <p role="alert" data-testid="calendar-add-event-no-local-calendar">{t('calendar-add-event.no-local-calendar')}</p> : null}
        <form onSubmit={(event) => { void submit(event).catch((caught: unknown) => setError(errorMessage(caught))); }} style={{ display: 'grid', gap: 'var(--kp-space-3)', marginTop: 'var(--kp-space-4)' }}>
          <label>
            <Label htmlFor="calendar-add-event-title">{t('calendar-add-event.fields.title')}</Label>
            <Input id="calendar-add-event-title" data-testid="calendar-add-event-title" value={form.title} onChange={(event) => { update({ title: event.target.value }); }} />
          </label>
          <label>
            <Label htmlFor="calendar-add-event-notes">{t('calendar-add-event.fields.notes')}</Label>
            <Textarea id="calendar-add-event-notes" data-testid="calendar-add-event-notes" value={form.notes} onChange={(event) => { update({ notes: event.target.value }); }} />
          </label>
          <div style={{ display: 'grid', gap: 'var(--kp-space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
            <label>
              <Label htmlFor="calendar-add-event-start">{t('calendar-add-event.fields.start-utc')}</Label>
              <Input id="calendar-add-event-start" data-testid="calendar-add-event-start" type="datetime-local" value={form.startUtc} onChange={(event) => { update({ startUtc: event.target.value }); }} />
            </label>
            <label>
              <Label htmlFor="calendar-add-event-end">{t('calendar-add-event.fields.end-utc')}</Label>
              <Input id="calendar-add-event-end" data-testid="calendar-add-event-end" type="datetime-local" value={form.endUtc} onChange={(event) => { update({ endUtc: event.target.value }); }} />
            </label>
            <label>
              <Label htmlFor="calendar-add-event-timezone">{t('calendar-add-event.fields.timezone')}</Label>
              <Input id="calendar-add-event-timezone" data-testid="calendar-add-event-timezone" value={form.displayTimezone} onChange={(event) => { update({ displayTimezone: event.target.value }); }} />
            </label>
            <label>
              <Label htmlFor="calendar-add-event-calendar">{t('calendar-add-event.fields.calendar')}</Label>
              <select id="calendar-add-event-calendar" data-testid="calendar-add-event-calendar" value={form.calendarId} disabled={Boolean(editing)} onChange={(event) => { update({ calendarId: event.target.value }); }}>
                {localCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.label}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', gap: 'var(--kp-space-2)', alignItems: 'center' }}>
            <Input data-testid="calendar-add-event-all-day" type="checkbox" checked={form.allDay} onChange={(event) => { update({ allDay: event.target.checked }); }} />
            {t('calendar-add-event.fields.all-day')}
          </label>
          <fieldset style={{ border: '1px solid var(--kp-divider)', borderRadius: 'var(--kp-radius-md)', padding: 'var(--kp-space-3)', display: 'grid', gap: 'var(--kp-space-3)' }}>
            <legend>{t('calendar-add-event.recurrence.title')}</legend>
            <div style={{ display: 'grid', gap: 'var(--kp-space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))' }}>
              <label>
                <Label htmlFor="calendar-add-event-frequency">{t('calendar-add-event.recurrence.frequency')}</Label>
                <select id="calendar-add-event-frequency" data-testid="calendar-add-event-frequency" value={form.frequency} onChange={(event) => { update({ frequency: event.target.value as RecurrenceFrequency }); }}>
                  <option value="none">{t('calendar-add-event.recurrence.none')}</option>
                  <option value="daily">{t('calendar-add-event.recurrence.daily')}</option>
                  <option value="weekly">{t('calendar-add-event.recurrence.weekly')}</option>
                  <option value="monthly">{t('calendar-add-event.recurrence.monthly')}</option>
                  <option value="yearly">{t('calendar-add-event.recurrence.yearly')}</option>
                </select>
              </label>
              {form.frequency !== 'none' ? <label>
                <Label htmlFor="calendar-add-event-interval">{t('calendar-add-event.recurrence.interval')}</Label>
                <Input id="calendar-add-event-interval" data-testid="calendar-add-event-interval" type="number" min="1" value={form.interval} onChange={(event) => { update({ interval: event.target.value }); }} />
              </label> : null}
              {form.frequency !== 'none' ? <label>
                <Label htmlFor="calendar-add-event-count">{t('calendar-add-event.recurrence.count')}</Label>
                <Input id="calendar-add-event-count" data-testid="calendar-add-event-count" type="number" min="1" value={form.count} onChange={(event) => { update({ count: event.target.value }); }} />
              </label> : null}
            </div>
            {form.frequency === 'weekly' ? <div data-testid="calendar-add-event-weekdays" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-2)' }}>
              {WEEKDAYS.map((weekday) => <label key={weekday} style={{ display: 'flex', gap: 'var(--kp-space-1)', alignItems: 'center' }}>
                <input type="checkbox" checked={form.weekdays.includes(weekday)} onChange={() => { toggleWeekday(weekday); }} />
                {t(`calendar-add-event.weekdays.${weekday}`)}
              </label>)}
            </div> : null}
            {form.frequency === 'monthly' || form.frequency === 'yearly' ? <label>
              <Label htmlFor="calendar-add-event-month-days">{t('calendar-add-event.recurrence.month-days')}</Label>
              <Input id="calendar-add-event-month-days" data-testid="calendar-add-event-month-days" value={form.monthDays} onChange={(event) => { update({ monthDays: event.target.value }); }} placeholder={t('calendar-add-event.recurrence.month-days-placeholder')} />
            </label> : null}
          </fieldset>
          {error || events.error || capability.error ? <p role="alert" data-testid="calendar-add-event-error">{error ?? events.error ?? capability.error}</p> : null}
          {savedId ? <p data-testid="calendar-add-event-saved">{t('calendar-add-event.saved', { id: savedId })}</p> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-2)' }}>
            <Button type="submit" loading={saving} disabled={localCalendars.length === 0} iconLeft={CalendarPlus} data-testid="calendar-add-event-save">{editing ? t('calendar-add-event.update') : t('calendar-add-event.create')}</Button>
            {editing && editing.status !== 'cancelled' ? <Button variant="danger" disabled={saving} iconLeft={X} onClick={() => { void cancel().catch((caught: unknown) => setError(errorMessage(caught))); }} data-testid="calendar-add-event-cancel">{t('calendar-add-event.cancel')}</Button> : null}
          </div>
        </form>
      </Card>
      <Card variant="flat">
        <h3 style={{ marginTop: 0 }}>{t('calendar-add-event.existing-title')}</h3>
        {events.events.length === 0 ? <p>{t('calendar-add-event.empty')}</p> : <ul data-testid="calendar-add-event-list" style={{ display: 'grid', gap: 'var(--kp-space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
          {events.events.map((event) => <li key={event.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-3)', alignItems: 'center' }}>
            <span>{event.title}</span>
            <Button variant="secondary" size="sm" iconLeft={Pencil} onClick={() => { startEdit(event); }} data-testid={`calendar-add-event-edit-${event.id}`}>{t('calendar-add-event.edit')}</Button>
          </li>)}
        </ul>}
      </Card>
    </section>
  );
}

/** Flag guard: no calendar hook, form state, effect, or descriptor child runs while dark. */
export function CalendarAddEventMount() {
  const enabled = useFlag('calendar-add-event');
  if (!enabled) return null;
  return <EnabledCalendarAddEventMount />;
}
