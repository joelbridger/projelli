import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCalendarEventStore,
  type CalendarOccurrence,
} from '@/features/calendar';
import { useFlag } from '@/platform/flags';
import { calendarGridRange, type CalendarGridView } from './calendarGridRange';
import {
  defaultCalendarGridViewComposition,
  getEnabledCalendarGridViews,
  type CalendarGridViewComposition,
  type CalendarGridViewId,
} from './calendarGridViewRegistry';

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

export interface CalendarGridSurfaceProps {
  /** Public composition seam used by independently owned calendar presentations. */
  readonly viewComposition?: CalendarGridViewComposition;
  /** Stable anchor override for deterministic consumers and tests. */
  readonly now?: Date;
}

/**
 * The flag boundary deliberately owns no calendar read. The enabled child is
 * the only place that calls the public calendar hook or starts a query.
 */
export function CalendarGridSurface(props: CalendarGridSurfaceProps) {
  const enabled = useFlag('calendar-grid');
  if (!enabled) return null;
  return <CalendarGridSurfaceEnabled {...props} />;
}

function CalendarGridSurfaceEnabled({
  viewComposition = defaultCalendarGridViewComposition,
  now,
}: CalendarGridSurfaceProps) {
  const { t } = useTranslation();
  const calendar = useCalendarEventStore();
  const [anchor] = useState(() => now ?? new Date());
  const [rangeView, setRangeView] = useState<CalendarGridView>('month');
  const [activeViewId, setActiveViewId] = useState<CalendarGridViewId>('month');
  const [occurrences, setOccurrences] = useState<readonly CalendarOccurrence[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => calendarGridRange(rangeView, anchor), [anchor, rangeView]);
  const enabledViews = getEnabledCalendarGridViews(viewComposition);
  const activeView = enabledViews.find((descriptor) => descriptor.id === activeViewId)
    ?? enabledViews[0];

  useEffect(() => {
    let current = true;
    void calendar.listOccurrences(range).then((next) => {
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
  }, [calendar, range]);

  const selected = occurrences.find((occurrence) => occurrence.occurrenceKey === selectedKey) ?? null;
  const viewContext = {
    range,
    occurrences,
    selectedOccurrenceKey: selectedKey,
    onSelectOccurrence: setSelectedKey,
  } as const;

  return <section data-testid="calendar-grid" className="grid gap-4 p-[var(--kp-card-pad)] xl:grid-cols-[minmax(0,1fr)_18rem]">
    <div className="min-w-0 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">{t('calendar-grid.title')}</h2>
          <p className="m-0 mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{t('calendar-grid.description')}</p>
        </div>
        <div role="group" aria-label={t('calendar-grid.view-label')} className="flex flex-wrap gap-2">
          {enabledViews.map((descriptor) => <button
            key={descriptor.id}
            type="button"
            data-testid={`calendar-grid-view-${descriptor.id}`}
            className="kp-button kp-button--secondary kp-button--sm"
            aria-pressed={activeView?.id === descriptor.id}
            onClick={() => {
              setActiveViewId(descriptor.id);
              if (descriptor.rangeView) setRangeView(descriptor.rangeView);
            }}
          >{t(descriptor.labelKey)}</button>)}
        </div>
      </header>
      <p data-testid="calendar-grid-range" className="mt-4 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
        {range.startUtc} — {range.endUtc}
      </p>
      {error ? <p role="alert" data-testid="calendar-grid-error" className="text-[var(--kp-danger)]">{error}</p> : null}
      {occurrences.length === 0 && !error ? <p data-testid="calendar-grid-empty" className="text-[var(--kp-text-faint)]">{t('calendar-grid.empty')}</p> : null}
      <div data-testid="calendar-grid-view-outlet">
        {activeView?.mount(viewContext) ?? null}
      </div>
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
