import type { CSSProperties, ReactNode } from 'react';
import type { CalendarOccurrence } from '@/features/calendar';
import type { CalendarGridViewContext } from './calendarGridViewRegistry';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function occurrenceDayKey(occurrence: CalendarOccurrence): string {
  return dayKey(new Date(occurrence.startUtc));
}

function occurrencesForDay(
  occurrences: readonly CalendarOccurrence[],
  day: Date,
): readonly CalendarOccurrence[] {
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
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

function occurrenceTime(occurrence: CalendarOccurrence): string {
  if (occurrence.allDay) return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: occurrence.displayTimezone,
  }).format(new Date(occurrence.startUtc));
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: occurrence.displayTimezone,
  }).format(new Date(occurrence.startUtc));
}

function EventButton({
  occurrence,
  selectedOccurrenceKey,
  onSelectOccurrence,
  compact = false,
}: Pick<CalendarGridViewContext, 'selectedOccurrenceKey' | 'onSelectOccurrence'> & {
  occurrence: CalendarOccurrence;
  compact?: boolean;
}) {
  return <button
    type="button"
    data-testid={`calendar-occurrence-${occurrence.occurrenceKey}`}
    data-occurrence-key={occurrence.occurrenceKey}
    className={`w-full rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] text-left text-[var(--kp-navy)] ${compact ? 'p-1 text-[length:var(--kp-font-xs)]' : 'p-2 text-[length:var(--kp-font-sm)]'}`}
    aria-pressed={selectedOccurrenceKey === occurrence.occurrenceKey}
    onClick={() => { onSelectOccurrence(occurrence.occurrenceKey); }}
  >
    <strong className="block truncate">{occurrence.title}</strong>
    <span className="block text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">{occurrenceTime(occurrence)}</span>
  </button>;
}

export function CalendarMonthLayout(context: CalendarGridViewContext) {
  const days = daysInRange(context.range.startUtc, context.range.endUtc);
  const first = days[0];
  const leadingCells = first ? first.getUTCDay() : 0;
  const weekdaySeed = new Date(Date.UTC(2026, 0, 4));

  return <div data-testid="calendar-grid-month" role="grid" className="mt-4 grid grid-cols-7 overflow-hidden rounded-lg border border-[var(--kp-divider)]">
    {Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekdaySeed.getTime() + index * DAY_MS);
      return <div key={`weekday-${String(index)}`} role="columnheader" className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-center text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-text-dim)]">
        {dayLabel(day, { weekday: 'short' })}
      </div>;
    })}
    {Array.from({ length: leadingCells }, (_, index) => <div
      key={`leading-${String(index)}`}
      data-testid="calendar-grid-month-padding-cell"
      role="gridcell"
      aria-hidden="true"
      className="min-h-24 border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)]"
    />)}
    {days.map((day) => <div
      key={dayKey(day)}
      data-testid="calendar-grid-month-day"
      data-calendar-day={dayKey(day)}
      role="gridcell"
      className="min-h-24 border-b border-r border-[var(--kp-divider)] bg-[var(--kp-surface)] p-2"
    >
      <time dateTime={dayKey(day)} className="text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-text-dim)]">{day.getUTCDate()}</time>
      <div className="mt-1 grid gap-1">
        {occurrencesForDay(context.occurrences, day).map((occurrence) => <EventButton
          key={occurrence.occurrenceKey}
          occurrence={occurrence}
          selectedOccurrenceKey={context.selectedOccurrenceKey}
          onSelectOccurrence={context.onSelectOccurrence}
          compact
        />)}
      </div>
    </div>)}
  </div>;
}

function WeekAllDayRow(context: CalendarGridViewContext, days: readonly Date[]): ReactNode {
  return <>
    <div className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]" />
    {days.map((day) => <div
      key={`all-day-${dayKey(day)}`}
      data-testid="calendar-grid-week-all-day-lane"
      data-calendar-day={dayKey(day)}
      className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-surface)] p-1"
    >
      {occurrencesForDay(context.occurrences, day).filter((occurrence) => occurrence.allDay).map((occurrence) => <EventButton
        key={occurrence.occurrenceKey}
        occurrence={occurrence}
        selectedOccurrenceKey={context.selectedOccurrenceKey}
        onSelectOccurrence={context.onSelectOccurrence}
        compact
      />)}
    </div>)}
  </>;
}

export function CalendarWeekLayout(context: CalendarGridViewContext) {
  const days = daysInRange(context.range.startUtc, context.range.endUtc);
  const gridStyle = { gridTemplateColumns: '4.5rem repeat(7, minmax(7rem, 1fr))' } satisfies CSSProperties;

  return <div data-testid="calendar-grid-week" className="mt-4 overflow-x-auto rounded-lg border border-[var(--kp-divider)]">
    <div role="grid" className="grid min-w-[60rem]" style={gridStyle}>
      <div role="columnheader" className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)]" />
      {days.map((day) => <div key={`heading-${dayKey(day)}`} role="columnheader" data-testid="calendar-grid-week-day-heading" className="border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-center text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-text-dim)]">
        {dayLabel(day, { weekday: 'short', month: 'short', day: 'numeric' })}
      </div>)}
      {WeekAllDayRow(context, days)}
      {HOURS.map((hour) => <HourRow key={hour} hour={hour} days={days} context={context} />)}
    </div>
  </div>;
}

function HourRow({
  hour,
  days,
  context,
}: {
  hour: number;
  days: readonly Date[];
  context: CalendarGridViewContext;
}) {
  return <>
    <div data-testid="calendar-grid-week-hour-label" className="min-h-14 border-b border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
      {timeLabel(hour)}
    </div>
    {days.map((day) => {
      const timed = occurrencesForDay(context.occurrences, day).filter((occurrence) =>
        !occurrence.allDay && new Date(occurrence.startUtc).getUTCHours() === hour);
      return <div
        key={`${dayKey(day)}-${String(hour)}`}
        data-testid="calendar-grid-week-time-lane"
        data-calendar-day={dayKey(day)}
        data-calendar-hour={hour}
        role="gridcell"
        className="min-h-14 border-b border-r border-[var(--kp-divider)] bg-[var(--kp-surface)] p-1"
      >
        {timed.map((occurrence) => <EventButton
          key={occurrence.occurrenceKey}
          occurrence={occurrence}
          selectedOccurrenceKey={context.selectedOccurrenceKey}
          onSelectOccurrence={context.onSelectOccurrence}
          compact
        />)}
      </div>;
    })}
  </>;
}

export function CalendarDayLayout(context: CalendarGridViewContext) {
  const day = new Date(context.range.startUtc);
  const dayOccurrences = occurrencesForDay(context.occurrences, day);

  return <div data-testid="calendar-grid-day" className="mt-4 overflow-hidden rounded-lg border border-[var(--kp-divider)]">
    <header className="border-b border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3 font-semibold text-[var(--kp-navy)]">
      {dayLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}
    </header>
    <div data-testid="calendar-grid-day-all-day-lane" className="grid grid-cols-[4.5rem_minmax(0,1fr)] border-b border-[var(--kp-divider)]">
      <div className="border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)]" />
      <div className="grid gap-1 bg-[var(--kp-surface)] p-2">
        {dayOccurrences.filter((occurrence) => occurrence.allDay).map((occurrence) => <EventButton
          key={occurrence.occurrenceKey}
          occurrence={occurrence}
          selectedOccurrenceKey={context.selectedOccurrenceKey}
          onSelectOccurrence={context.onSelectOccurrence}
        />)}
      </div>
    </div>
    {HOURS.map((hour) => <div
      key={hour}
      data-testid="calendar-grid-day-hour"
      data-calendar-hour={hour}
      className="grid min-h-16 grid-cols-[4.5rem_minmax(0,1fr)] border-b border-[var(--kp-divider)]"
    >
      <div className="border-r border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-2 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">{timeLabel(hour)}</div>
      <div role="list" className="grid gap-1 bg-[var(--kp-surface)] p-2">
        {dayOccurrences.filter((occurrence) => !occurrence.allDay && new Date(occurrence.startUtc).getUTCHours() === hour).map((occurrence) => <EventButton
          key={occurrence.occurrenceKey}
          occurrence={occurrence}
          selectedOccurrenceKey={context.selectedOccurrenceKey}
          onSelectOccurrence={context.onSelectOccurrence}
        />)}
      </div>
    </div>)}
  </div>;
}
