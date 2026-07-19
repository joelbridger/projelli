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
import { CalendarEventSheet, eventSheetHeading } from './CalendarEventSheet';

const DAY_MS = 24 * 60 * 60 * 1000;

type CalendarGridLoadError = 'workspace-required' | 'load-failed';

interface CalendarGridLoadState {
  readonly key: string;
  readonly occurrences: readonly CalendarOccurrence[];
  readonly error: CalendarGridLoadError | null;
}

type CalendarGridClientPair = Pick<CalendarGridClientScope, 'householdRef' | 'matterId'>;

export interface CalendarGridClientScope {
  /** The canonical household identity selected by the shared client context. */
  readonly householdRef: string;
  /** The canonical matter paired with that exact household. */
  readonly matterId: string;
  /** Display-only client name used by the filtered empty state. */
  readonly displayName: string;
}

function chronological(occurrences: readonly CalendarOccurrence[]): readonly CalendarOccurrence[] {
  return [...occurrences].sort((left, right) =>
    left.startUtc.localeCompare(right.startUtc) || left.occurrenceKey.localeCompare(right.occurrenceKey));
}

function isStableScopeValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

/**
 * Selected-client projection is deliberately exact and fail-closed. The
 * calendar link itself must name a household and carry both halves of the
 * selected pair. Matter equality alone never proves household ownership.
 */
function projectOccurrencesForClient(
  occurrences: readonly CalendarOccurrence[],
  scope: CalendarGridClientPair | null,
): readonly CalendarOccurrence[] {
  if (scope === null) return occurrences;
  if (!isStableScopeValue(scope.householdRef) || !isStableScopeValue(scope.matterId)) return [];
  return occurrences.filter((occurrence) =>
    occurrence.contextRef?.kind === 'household'
    && occurrence.contextRef.id === scope.householdRef
    && occurrence.contextRef.matterId === scope.matterId);
}

function loadErrorKind(reason: unknown): CalendarGridLoadError {
  return reason instanceof Error && reason.message.includes('Open a workspace')
    ? 'workspace-required'
    : 'load-failed';
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

function dayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function selectedDateDefaults(value: string): { startUtc: string; endUtc: string } {
  const start = new Date(`${value}T09:00:00.000Z`);
  return { startUtc: start.toISOString(), endUtc: new Date(start.getTime() + 30 * 60 * 1000).toISOString() };
}

function readableRange(range: { startUtc: string; endUtc: string }, view: CalendarGridView): string {
  const start = new Date(range.startUtc);
  const inclusiveEnd = new Date(new Date(range.endUtc).getTime() - DAY_MS);
  if (view === 'month') return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
  if (view === 'day') return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(start);
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `${formatter.format(start)} – ${formatter.format(inclusiveEnd)}`;
}

function moveAnchor(anchor: Date, view: CalendarGridView, direction: -1 | 1): Date {
  const next = new Date(anchor);
  if (view === 'month') next.setUTCMonth(next.getUTCMonth() + direction);
  else next.setUTCDate(next.getUTCDate() + (view === 'week' ? 7 : 1) * direction);
  return next;
}

export interface CalendarGridSurfaceProps {
  /** Public composition seam used by independently owned calendar presentations. */
  readonly viewComposition?: CalendarGridViewComposition;
  /** Stable anchor override for deterministic consumers and tests. */
  readonly now?: Date;
  /** Optional real workspace-picker hand-off for the no-workspace recovery state. */
  readonly onOpenWorkspace?: () => void;
  /**
   * Exact selected-client pair. `null` (and omission for existing consumers)
   * is the explicit whole-firm projection; a non-null scope fails closed.
   */
  readonly clientScope?: CalendarGridClientScope | null;
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
  onOpenWorkspace,
  clientScope = null,
}: CalendarGridSurfaceProps) {
  const { t } = useTranslation();
  const calendar = useCalendarEventStore();
  const [anchor, setAnchor] = useState(() => now ?? new Date());
  const [today] = useState(() => now ?? new Date());
  const [rangeView, setRangeView] = useState<CalendarGridView>('month');
  const [activeViewId, setActiveViewId] = useState<CalendarGridViewId>('month');
  const [loadState, setLoadState] = useState<CalendarGridLoadState>({
    key: '',
    occurrences: [],
    error: null,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState(() => dayKey(now ?? new Date()));
  const [peekOpen, setPeekOpen] = useState(false);
  const [editor, setEditor] = useState<'new' | 'edit' | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const range = useMemo(() => calendarGridRange(rangeView, anchor), [anchor, rangeView]);
  const rangeKey = `${range.startUtc}:${range.endUtc}`;
  const scopeHouseholdRef = clientScope?.householdRef ?? null;
  const scopeMatterId = clientScope?.matterId ?? null;
  const projectionScope = useMemo<CalendarGridClientPair | null>(
    () => clientScope === null
      ? null
      : {
          householdRef: scopeHouseholdRef ?? '',
          matterId: scopeMatterId ?? '',
        },
    [clientScope, scopeHouseholdRef, scopeMatterId]
  );
  const clientSelectionKey = clientScope === null
    ? 'whole-firm'
    : JSON.stringify(['client', scopeHouseholdRef, scopeMatterId]);
  const queryKey = `${rangeKey}:${clientSelectionKey}`;
  const activeLoadState = loadState.key === queryKey
    ? loadState
    : { key: queryKey, occurrences: [], error: null };
  const occurrences = activeLoadState.occurrences;
  const error = activeLoadState.error;
  const loading = loadState.key !== queryKey;
  const enabledViews = getEnabledCalendarGridViews(viewComposition);
  const activeView = enabledViews.find((descriptor) => descriptor.id === activeViewId)
    ?? enabledViews[0];

  useEffect(() => {
    let current = true;
    void calendar.listOccurrences(range).then((next) => {
      if (!current) return;
      const sorted = chronological(projectOccurrencesForClient(next, projectionScope));
      setLoadState({ key: queryKey, occurrences: sorted, error: null });
      setSelectedKey((previous) => {
        if (sorted.some((item) => item.occurrenceKey === previous)) return previous;
        return null;
      });
    }).catch((reason: unknown) => {
      if (!current) return;
      setLoadState({ key: queryKey, occurrences: [], error: loadErrorKind(reason) });
      setSelectedKey(null);
    });
    return () => { current = false; };
  }, [calendar, projectionScope, queryKey, range]);

  useEffect(() => {
    if (!saveNotice) return undefined;
    const timeout = window.setTimeout(() => { setSaveNotice(null); }, 5000);
    return () => { window.clearTimeout(timeout); };
  }, [saveNotice]);

  const selected = occurrences.find((occurrence) => occurrence.occurrenceKey === selectedKey) ?? null;
  const defaultTimes = selectedDateDefaults(selectedDayKey);
  const selectOccurrence = (occurrenceKey: string) => {
    const occurrence = occurrences.find((item) => item.occurrenceKey === occurrenceKey);
    setSelectedKey(occurrenceKey);
    if (occurrence) setSelectedDayKey(dayKey(occurrence.startUtc));
    setPeekOpen(true);
  };
  const viewContext = {
    range,
    occurrences,
    selectedOccurrenceKey: selectedKey,
    selectedDayKey,
    todayDayKey: dayKey(today),
    onSelectOccurrence: selectOccurrence,
    onSelectDay: setSelectedDayKey,
  } as const;

  const nativeViews = enabledViews.filter((descriptor) => descriptor.rangeView !== undefined);
  const presentationViews = enabledViews.filter((descriptor) => descriptor.rangeView === undefined);
  const hasNoWorkspace = error === 'workspace-required';
  const errorCopy = hasNoWorkspace
    ? t('calendar-grid.errors.workspace-required', {
        defaultValue: 'Open a workspace to view calendar events.',
      })
    : t('calendar-grid.errors.load', {
        defaultValue: 'Calendar events could not be loaded. Try again.',
      });
  const clientName = clientScope?.displayName.trim() || clientScope?.householdRef;
  const emptyCopy = clientScope
    ? t('calendar-grid.empty-client', {
        client: clientName,
        defaultValue: 'No events for {{client}} in this range. This calendar is filtered to this client.',
      })
    : t('calendar-grid.empty');
  const handleSaved = () => {
    setEditor(null);
    setPeekOpen(false);
    setAnchor((current) => new Date(current));
    setSaveNotice(t('calendar-grid.editor.saved-confirmation'));
  };

  return <section data-testid="calendar-grid" className="min-w-0 p-[var(--kp-card-pad)]">
    <div className="min-w-0 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" data-testid="calendar-grid-previous" aria-label={t('calendar-grid.previous')} className="kp-icon-btn kp-icon-btn--secondary kp-icon-btn--sm" onClick={() => { setAnchor((current) => moveAnchor(current, rangeView, -1)); }}>‹</button>
          <button type="button" data-testid="calendar-grid-next" aria-label={t('calendar-grid.next')} className="kp-icon-btn kp-icon-btn--secondary kp-icon-btn--sm" onClick={() => { setAnchor((current) => moveAnchor(current, rangeView, 1)); }}>›</button>
          <div>
            <h2 data-testid="calendar-grid-range" className="m-0 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">{readableRange(range, rangeView)}</h2>
            <p className="m-0 mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{t('calendar-grid.description')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('calendar-grid.view-label')} className="flex overflow-hidden rounded-md border border-[var(--kp-divider)]">
            {nativeViews.map((descriptor) => <button key={descriptor.id} type="button" data-testid={`calendar-grid-view-${descriptor.id}`} className={`h-8 border-r border-[var(--kp-divider)] px-3 text-[length:var(--kp-font-xs)] font-semibold last:border-r-0 ${activeView?.id === descriptor.id ? 'bg-[var(--kp-action-bg)] text-[var(--kp-navy)]' : 'bg-[var(--kp-surface)] text-[var(--kp-text-dim)]'}`} aria-pressed={activeView?.id === descriptor.id} onClick={() => { setActiveViewId(descriptor.id); setRangeView(descriptor.rangeView as CalendarGridView); }}>{t(descriptor.labelKey)}</button>)}
          </div>
          {presentationViews.length > 0 ? <div role="group" aria-label={t('calendar-grid.presentation-label')} className="flex overflow-hidden rounded-md border border-[var(--kp-divider)]">
            {presentationViews.map((descriptor) => <button key={descriptor.id} type="button" data-testid={`calendar-grid-view-${descriptor.id}`} className={`h-8 border-r border-[var(--kp-divider)] px-3 text-[length:var(--kp-font-xs)] font-semibold last:border-r-0 ${activeView?.id === descriptor.id ? 'bg-[var(--kp-action-bg)] text-[var(--kp-navy)]' : 'bg-[var(--kp-surface)] text-[var(--kp-text-dim)]'}`} aria-pressed={activeView?.id === descriptor.id} onClick={() => { setActiveViewId(descriptor.id); }}>{t(descriptor.labelKey)}</button>)}
          </div> : null}
          {!hasNoWorkspace ? <button type="button" data-testid="calendar-grid-new-event" className="kp-btn kp-btn--primary kp-btn--sm" onClick={() => { setEditor('new'); }}>{t('calendar-grid.new-event')}</button> : null}
        </div>
      </header>
      <div className="relative" data-testid="calendar-grid-workspace">
        {activeView?.mount(viewContext) ?? null}
        {loading ? <div data-testid="calendar-grid-loading" className="absolute inset-x-4 top-4 rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-3 py-2 text-center text-[length:var(--kp-font-xs)] text-[var(--kp-text-dim)]">{t('calendar-grid.loading')}</div> : null}
        {error ? <div role="alert" data-testid="calendar-grid-error" className="absolute inset-x-4 top-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--kp-danger)] bg-[var(--kp-danger-bg)] px-3 py-2 text-[length:var(--kp-font-sm)] text-[var(--kp-navy)]"><span>{errorCopy}</span>{hasNoWorkspace ? (onOpenWorkspace ? <button type="button" className="kp-btn kp-btn--secondary kp-btn--sm" onClick={onOpenWorkspace}>{t('calendar-grid.open-workspace')}</button> : null) : <button type="button" className="kp-btn kp-btn--secondary kp-btn--sm" onClick={() => { setAnchor((current) => new Date(current)); }}>{t('calendar-grid.retry')}</button>}</div> : null}
        {!loading && !error && occurrences.length === 0 ? <div data-testid="calendar-grid-empty" className="absolute inset-x-4 top-4 grid min-h-28 place-items-center rounded-lg border border-dashed border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-4 text-center text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{emptyCopy}</div> : null}
      </div>
    </div>
    {saveNotice ? <div role="status" data-testid="calendar-grid-save-toast" className="fixed bottom-5 right-5 z-[var(--kp-z-toast)] rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] px-4 py-3 text-[length:var(--kp-font-sm)] font-semibold text-[var(--kp-navy)] shadow-[var(--kp-shadow-3)]">
      {saveNotice}
    </div> : null}
    {peekOpen && selected ? <aside data-testid="calendar-grid-peek" aria-label={t('calendar-grid.rail-label')} className="fixed bottom-0 right-0 top-0 z-[var(--kp-z-modal)] flex w-[min(480px,100vw)] flex-col border-l border-[var(--kp-divider)] bg-[var(--kp-surface)] p-5 shadow-[var(--kp-shadow-3)]">
      <div className="flex items-start justify-between gap-3"><div><h3 className="m-0 text-[length:var(--kp-font-md)] font-semibold text-[var(--kp-navy)]">{eventSheetHeading(selected.title, t('calendar-grid.editor.untitled'))}</h3><p className="m-0 mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">{localTime(selected)}</p></div><button type="button" className="kp-icon-btn kp-icon-btn--secondary kp-icon-btn--sm" aria-label={t('calendar-grid.close-peek')} onClick={() => { setPeekOpen(false); }}>×</button></div>
      <div data-testid="calendar-grid-selection" className="mt-5 grid gap-2 text-[length:var(--kp-font-sm)] text-[var(--kp-text-dim)]"><span>{t('calendar-grid.calendar', { calendarId: selected.calendarId })}</span><span data-testid="calendar-grid-selection-status">{t(`calendar-grid.status.${selected.status}`)}</span>{selected.contextRef?.label ? <span>{t('calendar-grid.linked-record', { record: selected.contextRef.label })}</span> : null}</div>
      <div className="mt-auto flex justify-end gap-2 border-t border-[var(--kp-divider)] pt-4"><button type="button" className="kp-btn kp-btn--secondary kp-btn--sm" onClick={() => { setPeekOpen(false); }}>{t('calendar-grid.close')}</button><button type="button" data-testid="calendar-grid-edit-event" className="kp-btn kp-btn--primary kp-btn--sm" onClick={() => { setPeekOpen(false); setEditor('edit'); }}>{t('calendar-grid.edit-event')}</button></div>
    </aside> : null}
    {editor === 'edit' && selected ? <CalendarEventSheet calendar={calendar} occurrence={selected} defaultStartUtc={defaultTimes.startUtc} defaultEndUtc={defaultTimes.endUtc} onClose={() => { setEditor(null); }} onSaved={handleSaved} /> : null}
    {editor === 'new' ? <CalendarEventSheet calendar={calendar} defaultStartUtc={defaultTimes.startUtc} defaultEndUtc={defaultTimes.endUtc} onClose={() => { setEditor(null); }} onSaved={handleSaved} /> : null}
  </section>;
}
