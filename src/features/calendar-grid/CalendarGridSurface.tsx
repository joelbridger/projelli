import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCalendarEventStore,
  type CalendarOccurrence,
} from '@/features/calendar';
import { useFlag } from '@/platform/flags';
import { calendarGridRange, type CalendarGridView } from './calendarGridRange';

function chronological(occurrences: readonly CalendarOccurrence[]): readonly CalendarOccurrence[] {
  return [...occurrences].sort((left, right) =>
    left.startUtc.localeCompare(right.startUtc) || left.occurrenceKey.localeCompare(right.occurrenceKey));
}

function localTime(occurrence: CalendarOccurrence): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: occurrence.displayTimezone,
    month: 'short',
    day: 'numeric',
    hour: occurrence.allDay ? undefined : 'numeric',
    minute: occurrence.allDay ? undefined : '2-digit',
  }).format(new Date(occurrence.startUtc));
}

/**
 * The flag boundary deliberately owns no calendar read. The enabled child is
 * the only place that calls the public calendar hook or starts a query.
 */
export function CalendarGridSurface() {
  const enabled = useFlag('calendar-grid');
  if (!enabled) return null;
  return <CalendarGridSurfaceEnabled />;
}

function CalendarGridSurfaceEnabled() {
  const { t } = useTranslation();
  const events = useCalendarEventStore();
  const eventsRef = useRef(events);
  const eventVersion = events.events.map((event) => `${event.id}:${event.status}`).join('\u0000');
  const [view, setView] = useState<CalendarGridView>('month');
  const [occurrences, setOccurrences] = useState<readonly CalendarOccurrence[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => calendarGridRange(view), [view]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    let current = true;
    void eventsRef.current.listOccurrences(range).then((next) => {
      if (!current) return;
      const sorted = chronological(next);
      setError(null);
      setOccurrences(sorted);
      setSelectedKey((previous) => sorted.some((item) => item.occurrenceKey === previous)
        ? previous
        : (sorted[0]?.occurrenceKey ?? null));
    }).catch((reason: unknown) => {
      if (!current) return;
      setOccurrences([]);
      setSelectedKey(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { current = false; };
  }, [eventVersion, range]);

  const selected = occurrences.find((occurrence) => occurrence.occurrenceKey === selectedKey) ?? null;

  return <section data-testid="calendar-grid" className="grid gap-4 p-[var(--kp-card-pad)] xl:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="min-w-0 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">{t('calendar-grid.title')}</h2>
          <p className="m-0 mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{t('calendar-grid.description')}</p>
        </div>
        <div role="group" aria-label={t('calendar-grid.view-label')} className="flex gap-2">
          {(['month', 'week', 'day'] as const).map((choice) => <button
            key={choice}
            type="button"
            data-testid={`calendar-grid-view-${choice}`}
            className="kp-button kp-button--secondary kp-button--sm"
            aria-pressed={view === choice}
            onClick={() => { setView(choice); }}
          >{t(`calendar-grid.views.${choice}`)}</button>)}
        </div>
      </header>
      <p data-testid="calendar-grid-range" className="mt-4 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
        {range.startUtc} — {range.endUtc}
      </p>
      {error ? <p role="alert" data-testid="calendar-grid-error" className="text-[var(--kp-danger)]">{error}</p> : null}
      {occurrences.length === 0 && !error ? <p data-testid="calendar-grid-empty" className="text-[var(--kp-text-faint)]">{t('calendar-grid.empty')}</p> : null}
      <ol data-testid="calendar-grid-occurrences" className="m-0 grid list-none gap-2 p-0">
        {occurrences.map((occurrence) => <li key={occurrence.occurrenceKey}>
          <button
            type="button"
            data-testid={`calendar-occurrence-${occurrence.occurrenceKey}`}
            className="w-full rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3 text-left text-[var(--kp-navy)]"
            aria-pressed={selected?.occurrenceKey === occurrence.occurrenceKey}
            onClick={() => { setSelectedKey(occurrence.occurrenceKey); }}
          >
            <strong>{occurrence.title}</strong>
            <span className="ml-2 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{localTime(occurrence)}</span>
          </button>
        </li>)}
      </ol>
    </div>
    <aside data-testid="calendar-grid-rail" aria-label={t('calendar-grid.rail-label')} className="rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] p-4">
      <h3 className="m-0 text-[length:var(--kp-font-md)] font-semibold text-[var(--kp-navy)]">{t('calendar-grid.rail-title')}</h3>
      {selected ? <div data-testid="calendar-grid-selection" className="mt-3 grid gap-2 text-[length:var(--kp-font-sm)] text-[var(--kp-text-dim)]">
        <strong className="text-[var(--kp-navy)]">{selected.title}</strong>
        <span>{localTime(selected)}</span>
        <span>{t('calendar-grid.calendar', { calendarId: selected.calendarId })}</span>
        <span data-testid="calendar-grid-selection-status">{t(`calendar-grid.status.${selected.status}`)}</span>
      </div> : <p data-testid="calendar-grid-rail-empty" className="text-[var(--kp-text-faint)]">{t('calendar-grid.rail-empty')}</p>}
    </aside>
  </section>;
}
