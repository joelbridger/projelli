import { useMemo, useRef, useState, type FormEvent } from 'react';
import { CalendarPlus, Pencil } from 'lucide-react';
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
import { Button } from '@/ui/kp';
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
const selectClassName = 'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

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
  if (error instanceof CalendarFoundationError) return error.message;
  return error instanceof Error ? error.message : 'The event could not be saved. Try again.';
}

/** Short, calm heading fallback for imported or partially completed events. */
function eventHeading(title: string, fallback: string): string {
  const clean = title.trim();
  if (clean === '') return fallback;
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}…` : clean;
}

function contextLabel(event: CalendarEventRecord | null, unlinked: string): string {
  const context = event?.contextRef;
  if (!context) return unlinked;
  return context.label?.trim() || context.id;
}

/** The enabled child is the first place calendar stores and form state are read. */
function EnabledCalendarAddEventMount() {
  const { t } = useTranslation();
  const events = useCalendarEventStore();
  const capability = useCalendarCapabilityStore();
  const endInputRef = useRef<HTMLInputElement>(null);
  const localCalendars = useMemo(
    () => capability.state.calendars.filter((calendar) => calendar.ownership === 'local'),
    [capability.state.calendars],
  );
  const [editing, setEditing] = useState<CalendarEventRecord | null>(null);
  const [form, setForm] = useState<EventForm>(() => newForm(capability.state.homeCalendarId));
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const update = (changes: Partial<EventForm>) => { setForm((current) => ({ ...current, ...changes })); };
  const startNew = () => {
    setEditing(null);
    setForm(newForm(capability.state.homeCalendarId));
    setError(null);
    setEndError(null);
    setSuccess(null);
    setOpen(true);
  };
  const startEdit = (event: CalendarEventRecord) => {
    setEditing(event);
    setForm(formFromEvent(event));
    setError(null);
    setEndError(null);
    setSuccess(null);
    setOpen(true);
  };
  const dismiss = () => {
    if (saving) return;
    setOpen(false);
    setError(null);
    setEndError(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setEndError(null);
    setSuccess(null);
    if (Date.parse(utcFromInput(form.endUtc)) <= Date.parse(utcFromInput(form.startUtc))) {
      setEndError(t('calendar-add-event.errors.end-before-start'));
      endInputRef.current?.focus();
      return;
    }
    setSaving(true);
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
      setEditing(saved);
      setForm(formFromEvent(saved));
      setOpen(false);
      setSuccess(t('calendar-add-event.saved'));
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
  const heading = editing
    ? eventHeading(editing.title, t('calendar-add-event.untitled-event'))
    : t('calendar-add-event.new-event');

  return (
    <section data-testid="calendar-add-event-mount" style={{ minHeight: '100%', position: 'relative' }}>
      <div aria-hidden={open || undefined} data-testid="calendar-add-event-source" style={{ display: 'grid', gap: 'var(--kp-space-md)', padding: 'var(--kp-card-pad)', pointerEvents: open ? 'none' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--kp-space-sm)' }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('calendar-add-event.source-title')}</h2>
            <p style={{ margin: 'var(--kp-space-2xs) 0 0', color: 'var(--kp-text-faint)' }}>{t('calendar-add-event.source-description')}</p>
          </div>
          <Button variant="secondary" size="sm" iconLeft={CalendarPlus} onClick={startNew} data-testid="calendar-add-event-new">{t('calendar-add-event.new-event')}</Button>
        </div>
        <div style={{ border: '1px solid var(--kp-divider)', borderRadius: '8px', minHeight: '9rem', padding: 'var(--kp-space-md)' }}>
          {events.events.length === 0 ? <p style={{ margin: 0, color: 'var(--kp-text-faint)' }}>{t('calendar-add-event.source-empty')}</p> : <ul data-testid="calendar-add-event-list" style={{ display: 'grid', gap: 'var(--kp-space-xs)', margin: 0, padding: 0, listStyle: 'none' }}>
            {events.events.map((calendarEvent) => <li key={calendarEvent.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-sm)', alignItems: 'center' }}>
              <span>{calendarEvent.title}</span>
              <Button variant="secondary" size="sm" iconLeft={Pencil} onClick={() => { startEdit(calendarEvent); }} data-testid={`calendar-add-event-edit-${calendarEvent.id}`}>{t('calendar-add-event.edit')}</Button>
            </li>)}
          </ul>}
        </div>
      </div>

      {success ? <p role="status" data-testid="calendar-add-event-saved" style={{ margin: 'var(--kp-space-sm) var(--kp-card-pad)', color: 'var(--kp-text-faint)' }}>{success}</p> : null}

      {open ? <div className="kp-overlay" data-testid="calendar-add-event-sheet-overlay" role="presentation" style={{ alignItems: 'center', justifyContent: 'center', padding: 'var(--kp-space-lg)' }}>
        <section
          aria-labelledby="calendar-add-event-sheet-heading"
          aria-modal="true"
          role="dialog"
          data-testid="calendar-add-event-sheet"
          style={{
            background: 'var(--color-background)', border: '1px solid var(--color-border)', borderRadius: '8px',
            boxShadow: 'var(--kp-shadow-3)', boxSizing: 'border-box', maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto', padding: '22px', width: 'min(520px, calc(100vw - 32px))',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-sm)', alignItems: 'baseline' }}>
            <h2 id="calendar-add-event-sheet-heading" style={{ margin: 0, overflowWrap: 'anywhere' }}>{heading}</h2>
            <span data-testid="calendar-add-event-status" style={{ border: '1px solid var(--kp-divider)', borderRadius: '999px', color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-xs)', padding: '2px 8px', whiteSpace: 'nowrap' }}>{t('calendar-add-event.status.local-save')}</span>
          </div>
          {localCalendars.length === 0 ? <p role="alert" data-testid="calendar-add-event-no-local-calendar">{t('calendar-add-event.no-local-calendar')}</p> : null}
          <form onSubmit={(event) => { void submit(event).catch((caught: unknown) => setError(errorMessage(caught))); }} style={{ display: 'grid', gap: 'var(--kp-space-sm)', marginTop: 'var(--kp-space-md)' }}>
            <label>
              <Label htmlFor="calendar-add-event-title">{t('calendar-add-event.fields.title')}</Label>
              <Input id="calendar-add-event-title" data-testid="calendar-add-event-title" placeholder={t('calendar-add-event.fields.title-placeholder')} value={form.title} onChange={(event) => { update({ title: event.target.value }); }} />
            </label>
            <div style={{ display: 'grid', gap: 'var(--kp-space-sm)', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <label>
                <Label htmlFor="calendar-add-event-start">{t('calendar-add-event.fields.start')}</Label>
                <Input id="calendar-add-event-start" data-testid="calendar-add-event-start" type="datetime-local" value={form.startUtc} onChange={(event) => { update({ startUtc: event.target.value }); }} />
              </label>
              <label>
                <Label htmlFor="calendar-add-event-end">{t('calendar-add-event.fields.end')}</Label>
                <Input ref={endInputRef} aria-describedby={endError ? 'calendar-add-event-end-error' : undefined} aria-invalid={Boolean(endError)} id="calendar-add-event-end" data-testid="calendar-add-event-end" type="datetime-local" value={form.endUtc} onChange={(event) => { setEndError(null); update({ endUtc: event.target.value }); }} />
                {endError ? <p id="calendar-add-event-end-error" role="alert" data-testid="calendar-add-event-end-error" style={{ margin: '4px 0 0', fontSize: 'var(--kp-font-sm)', fontWeight: 600 }}>{endError}</p> : null}
              </label>
            </div>
            <label>
              <Label htmlFor="calendar-add-event-calendar">{t('calendar-add-event.fields.calendar')}</Label>
              <select className={selectClassName} id="calendar-add-event-calendar" data-testid="calendar-add-event-calendar" value={form.calendarId} disabled={Boolean(editing)} onChange={(event) => { update({ calendarId: event.target.value }); }}>
                {localCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.label}</option>)}
              </select>
            </label>
            <div>
              <Label>{t('calendar-add-event.fields.linked-record')}</Label>
              <div data-testid="calendar-add-event-linked-record" style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '8px 11px', color: 'var(--kp-text-faint)' }}>{contextLabel(editing, t('calendar-add-event.unlinked-record'))}</div>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('calendar-add-event.options.title')}</summary>
              <div style={{ display: 'grid', gap: 'var(--kp-space-sm)', marginTop: 'var(--kp-space-sm)' }}>
                <label style={{ display: 'flex', gap: 'var(--kp-space-xs)', alignItems: 'center' }}>
                  <Input className="h-4 w-4" data-testid="calendar-add-event-all-day" type="checkbox" checked={form.allDay} onChange={(event) => { update({ allDay: event.target.checked }); }} />
                  {t('calendar-add-event.fields.all-day')}
                </label>
                <label>
                  <Label htmlFor="calendar-add-event-timezone">{t('calendar-add-event.fields.timezone')}</Label>
                  <Input id="calendar-add-event-timezone" data-testid="calendar-add-event-timezone" value={form.displayTimezone} onChange={(event) => { update({ displayTimezone: event.target.value }); }} />
                </label>
                <label>
                  <Label htmlFor="calendar-add-event-frequency">{t('calendar-add-event.recurrence.frequency')}</Label>
                  <select className={selectClassName} id="calendar-add-event-frequency" data-testid="calendar-add-event-frequency" value={form.frequency} onChange={(event) => { update({ frequency: event.target.value as RecurrenceFrequency }); }}>
                    <option value="none">{t('calendar-add-event.recurrence.none')}</option>
                    <option value="daily">{t('calendar-add-event.recurrence.daily')}</option>
                    <option value="weekly">{t('calendar-add-event.recurrence.weekly')}</option>
                    <option value="monthly">{t('calendar-add-event.recurrence.monthly')}</option>
                    <option value="yearly">{t('calendar-add-event.recurrence.yearly')}</option>
                  </select>
                </label>
                {form.frequency !== 'none' ? <div style={{ display: 'grid', gap: 'var(--kp-space-sm)', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <label><Label htmlFor="calendar-add-event-interval">{t('calendar-add-event.recurrence.interval')}</Label><Input id="calendar-add-event-interval" data-testid="calendar-add-event-interval" type="number" min="1" value={form.interval} onChange={(event) => { update({ interval: event.target.value }); }} /></label>
                  <label><Label htmlFor="calendar-add-event-count">{t('calendar-add-event.recurrence.count')}</Label><Input id="calendar-add-event-count" data-testid="calendar-add-event-count" type="number" min="1" value={form.count} onChange={(event) => { update({ count: event.target.value }); }} /></label>
                </div> : null}
                {form.frequency === 'weekly' ? <div data-testid="calendar-add-event-weekdays" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--kp-space-xs)' }}>
                  {WEEKDAYS.map((weekday) => <label key={weekday} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={form.weekdays.includes(weekday)} onChange={() => { toggleWeekday(weekday); }} />{t(`calendar-add-event.weekdays.${weekday}`)}</label>)}
                </div> : null}
                {form.frequency === 'monthly' || form.frequency === 'yearly' ? <label><Label htmlFor="calendar-add-event-month-days">{t('calendar-add-event.recurrence.month-days')}</Label><Input id="calendar-add-event-month-days" data-testid="calendar-add-event-month-days" value={form.monthDays} onChange={(event) => { update({ monthDays: event.target.value }); }} placeholder={t('calendar-add-event.recurrence.month-days-placeholder')} /></label> : null}
                <label>
                  <Label htmlFor="calendar-add-event-notes">{t('calendar-add-event.fields.notes')}</Label>
                  <Textarea id="calendar-add-event-notes" data-testid="calendar-add-event-notes" value={form.notes} onChange={(event) => { update({ notes: event.target.value }); }} />
                </label>
              </div>
            </details>
            {error || events.error || capability.error ? <p role="alert" data-testid="calendar-add-event-error" style={{ margin: 0 }}>{error ?? events.error ?? capability.error}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 'var(--kp-space-xs)', marginTop: 'var(--kp-space-xs)' }}>
              <Button variant="secondary" disabled={saving} onClick={dismiss} data-testid="calendar-add-event-cancel">{t('calendar-add-event.cancel')}</Button>
              <Button type="submit" variant="primary" loading={saving} disabled={localCalendars.length === 0} iconLeft={saving ? undefined : CalendarPlus} data-testid="calendar-add-event-save">{saving ? t('calendar-add-event.saving') : t('calendar-add-event.save')}</Button>
            </div>
          </form>
        </section>
      </div> : null}
    </section>
  );
}

/** Flag guard: no calendar hook, form state, effect, or descriptor child runs while dark. */
export function CalendarAddEventMount() {
  const enabled = useFlag('calendar-add-event');
  if (!enabled) return null;
  return <EnabledCalendarAddEventMount />;
}
