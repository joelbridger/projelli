import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarOccurrence } from '@/features/calendar';
import type { CalendarGridViewContext } from './calendarGridViewRegistry';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function occurrenceDayKey(occurrence: CalendarOccurrence): string {
  return dayKey(new Date(occurrence.startUtc));
}

function occurrencesForDay(occurrences: readonly CalendarOccurrence[], day: Date): readonly CalendarOccurrence[] {
  const key = dayKey(day);
  return occurrences.filter((occurrence) => occurrenceDayKey(occurrence) === key);
}

function daysInRange(startUtc: string, endUtc: string): readonly Date[] {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  const days: Date[] = [];
  for (let cursor = start; cursor < end; cursor += DAY_MS) days.push(new Date(cursor));
  return days;
}

function dayLabel(day: Date, format: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...format, timeZone: 'UTC' }).format(day);
}

function timeLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

function occurrenceTime(occurrence: CalendarOccurrence, allDayLabel: string): string {
  if (occurrence.allDay) return allDayLabel;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: occurrence.displayTimezone }).format(new Date(occurrence.startUtc));
}

function EventButton({
  occurrence,
  selectedOccurrenceKey,
  onSelectOccurrence,
  compact = false,
  style,
}: Pick<CalendarGridViewContext, 'selectedOccurrenceKey' | 'onSelectOccurrence'> & {
  occurrence: CalendarOccurrence;
  compact?: boolean;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  return <button
    type="button"
    data-testid={`calendar-occurrence-${occurrence.occurrenceKey}`}
    data-occurrence-key={occurrence.occurrenceKey}
    style={style}
    className={`overflow-hidden rounded border border-[var(--kp-divider)] border-l-[3px] border-l-[var(--kp-accent)] bg-[var(--kp-action-bg)] text-left text-[var(--kp-navy)] ${compact ? 'p-1 text-[length:var(--kp-font-xs)]' : 'p-2 text-[length:var(--kp-font-sm)]'} ${selectedOccurrenceKey === occurrence.occurrenceKey ? 'ring-2 ring-[var(--kp-accent)] ring-offset-1' : ''}`}
    aria-pressed={selectedOccurrenceKey === occurrence.occurrenceKey}
    onClick={() => { onSelectOccurrence(occurrence.occurrenceKey); }}
  >
    <span className="block truncate text-[length:var(--kp-font-xs)] text-[var(--kp-text-dim)]">{occurrenceTime(occurrence, t('calendar-grid.all-day'))}</span>
    <strong className="block truncate">{occurrence.title}</strong>
  </button>;
}

function monthCells(context: CalendarGridViewContext): readonly Date[] {
  const days = daysInRange(context.range.startUtc, context.range.endUtc);
  const first = days[0];
  if (!first) return [];
  const start = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY_MS));
}

export function CalendarMonthLayout(context: CalendarGridViewContext) {
  const cells = monthCells(context);
  const month = new Date(context.range.startUtc).getUTCMonth();
  const weekdaySeed = new Date(Date.UTC(2026, 0, 4));
  return <div data-testid="calendar-grid-month" role="grid" className="mt-4 grid grid-cols-7 overflow-hidden rounded-lg border border-[var(--kp-divider)]">
    {Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekdaySeed.getTime() + index * DAY_MS);
      return <div key={`weekday-${String(index)}`} role="columnheader" className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-center text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-text-dim)]">{dayLabel(day, { weekday: 'short' })}</div>;
    })}
    {cells.map((day) => {
      const key = dayKey(day);
      const isCurrentMonth = day.getUTCMonth() === month;
      const isSelected = key === context.selectedDayKey;
      const isToday = key === context.todayDayKey;
      return <div
        key={key}
        data-testid="calendar-grid-month-day"
        data-calendar-day={key}
        data-selected-day={isSelected || undefined}
        role="gridcell"
        className={`min-h-24 border-b border-r border-[var(--kp-divider)] p-2 text-left ${isSelected ? 'bg-[var(--kp-action-bg)]' : 'bg-[var(--kp-surface)]'} ${isCurrentMonth ? 'text-[var(--kp-navy)]' : 'text-[var(--kp-text-faint)]'}`}
      >
        <button type="button" onClick={() => { context.onSelectDay(key); }} className={`inline-flex min-w-5 justify-center rounded-full text-[length:var(--kp-font-xs)] font-semibold ${isToday ? 'border border-[var(--kp-accent)] px-1 text-[var(--kp-navy)]' : ''}`}><time dateTime={key}>{day.getUTCDate()}</time></button>
        <span className="mt-1 grid gap-1">
          {occurrencesForDay(context.occurrences, day).map((occurrence) => <EventButton key={occurrence.occurrenceKey} occurrence={occurrence} selectedOccurrenceKey={context.selectedOccurrenceKey} onSelectOccurrence={context.onSelectOccurrence} compact />)}
        </span>
      </div>;
    })}
  </div>;
}

function WeekAllDayRow(context: CalendarGridViewContext, days: readonly Date[]): ReactNode {
  return <div className="grid" style={{ gridTemplateColumns: '4.5rem repeat(7, minmax(7rem, 1fr))' }}>
    <div className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]" />
    {days.map((day) => <div key={`all-day-${dayKey(day)}`} data-testid="calendar-grid-week-all-day-lane" data-calendar-day={dayKey(day)} className="min-h-10 border-b border-r border-[var(--kp-divider)] bg-[var(--kp-surface)] p-1">
      {occurrencesForDay(context.occurrences, day).filter((occurrence) => occurrence.allDay).map((occurrence) => <EventButton key={occurrence.occurrenceKey} occurrence={occurrence} selectedOccurrenceKey={context.selectedOccurrenceKey} onSelectOccurrence={context.onSelectOccurrence} compact />)}
    </div>)}
  </div>;
}

interface TimedPlacement { occurrence: CalendarOccurrence; column: number; columns: number; }

/** Greedy overlap lanes keep simultaneous events side-by-side instead of stacked. */
function timedPlacements(occurrences: readonly CalendarOccurrence[]): readonly TimedPlacement[] {
  const sorted = occurrences.filter((item) => !item.allDay).slice().sort((left, right) => left.startUtc.localeCompare(right.startUtc));
  const result: TimedPlacement[] = [];
  let cluster: CalendarOccurrence[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const ends: number[] = [];
    const assigned = cluster.map((occurrence) => {
      const start = Date.parse(occurrence.startUtc);
      let column = ends.findIndex((end) => end <= start);
      if (column < 0) column = ends.length;
      ends[column] = Date.parse(occurrence.endUtc);
      return { occurrence, column };
    });
    result.push(...assigned.map((item) => ({ ...item, columns: ends.length })));
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const occurrence of sorted) {
    const start = Date.parse(occurrence.startUtc);
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(occurrence);
    clusterEnd = Math.max(clusterEnd, Date.parse(occurrence.endUtc));
  }
  if (cluster.length) flush();
  return result;
}

function placementStyle(placement: TimedPlacement): CSSProperties {
  const start = new Date(placement.occurrence.startUtc);
  const end = new Date(placement.occurrence.endUtc);
  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const duration = Math.max(18, ((end.getTime() - start.getTime()) / 60_000) * (HOUR_HEIGHT / 60));
  const width = 100 / placement.columns;
  return {
    position: 'absolute',
    top: `${String(startMinutes * (HOUR_HEIGHT / 60))}px`,
    height: `${String(duration)}px`,
    left: `calc(${String(placement.column * width)}% + 2px)`,
    width: `calc(${String(width)}% - 4px)`,
    zIndex: 1,
  };
}

function DayTimeline({ day, context, testPrefix }: { day: Date; context: CalendarGridViewContext; testPrefix: 'week' | 'day' }) {
  const placements = timedPlacements(occurrencesForDay(context.occurrences, day));
  return <div className="relative h-[1344px] bg-[var(--kp-surface)]">
    {HOURS.map((hour) => <div key={hour} data-testid={`calendar-grid-${testPrefix}-${testPrefix === 'week' ? 'time-lane' : 'hour'}`} data-calendar-day={testPrefix === 'week' ? dayKey(day) : undefined} data-calendar-hour={hour} className="h-14 border-b border-[var(--kp-divider)]" />)}
    {placements.map((placement) => <EventButton key={placement.occurrence.occurrenceKey} occurrence={placement.occurrence} selectedOccurrenceKey={context.selectedOccurrenceKey} onSelectOccurrence={context.onSelectOccurrence} style={placementStyle(placement)} />)}
  </div>;
}

export function CalendarWeekLayout(context: CalendarGridViewContext) {
  const days = daysInRange(context.range.startUtc, context.range.endUtc);
  const gridStyle = { gridTemplateColumns: '4.5rem repeat(7, minmax(7rem, 1fr))' } satisfies CSSProperties;
  return <div data-testid="calendar-grid-week" className="mt-4 overflow-x-auto rounded-lg border border-[var(--kp-divider)]">
    <div className="min-w-[60rem]">
      <div role="grid" className="grid" style={gridStyle}>
        <div role="columnheader" className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)]" />
        {days.map((day) => <div key={`heading-${dayKey(day)}`} role="columnheader" data-testid="calendar-grid-week-day-heading" className={`border-b border-r border-[var(--kp-divider)] p-2 text-center text-[length:var(--kp-font-xs)] font-semibold ${dayKey(day) === context.selectedDayKey ? 'bg-[var(--kp-action-bg)] text-[var(--kp-navy)]' : 'bg-[var(--kp-bg-soft)] text-[var(--kp-text-dim)]'}`}>{dayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })}</div>)}
      </div>
      {WeekAllDayRow(context, days)}
      <div className="grid" style={gridStyle}>
        <div className="bg-[var(--kp-bg-soft)]">{HOURS.map((hour) => <div key={hour} data-testid="calendar-grid-week-hour-label" className="h-14 border-b border-r border-[var(--kp-divider)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">{timeLabel(hour)}</div>)}</div>
        {days.map((day) => <div key={`timeline-${dayKey(day)}`} className="border-r border-[var(--kp-divider)]"><DayTimeline day={day} context={context} testPrefix="week" /></div>)}
      </div>
    </div>
  </div>;
}

export function CalendarDayLayout(context: CalendarGridViewContext) {
  const day = new Date(context.range.startUtc);
  const allDay = occurrencesForDay(context.occurrences, day).filter((occurrence) => occurrence.allDay);
  return <div data-testid="calendar-grid-day" className="mt-4 overflow-hidden rounded-lg border border-[var(--kp-divider)]">
    <header className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3 font-semibold text-[var(--kp-navy)]">{dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}</header>
    <div data-testid="calendar-grid-day-all-day-lane" className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-b border-[var(--kp-divider)]"><div className="border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)]" /><div className="grid gap-1 bg-[var(--kp-surface)] p-2">{allDay.map((occurrence) => <EventButton key={occurrence.occurrenceKey} occurrence={occurrence} selectedOccurrenceKey={context.selectedOccurrenceKey} onSelectOccurrence={context.onSelectOccurrence} />)}</div></div>
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)]"><div className="bg-[var(--kp-bg-soft)]">{HOURS.map((hour) => <div key={hour} className="h-14 border-b border-r border-[var(--kp-divider)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">{timeLabel(hour)}</div>)}</div><DayTimeline day={day} context={context} testPrefix="day" /></div>
  </div>;
}
