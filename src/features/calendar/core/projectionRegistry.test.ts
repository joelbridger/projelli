import { describe, expect, it, vi } from 'vitest';
import {
  calendarProjectionRegistry,
  canonicalLocalCalendarProjection,
  composeCalendarReadProjections,
  validateCalendarProjectionDescriptors,
  type CalendarProjectionDescriptor,
} from './projectionRegistry';

declare module '@/features/calendar' {
  interface CalendarProjectionMap {
    'third-party-read': CalendarProjectionDescriptor<'third-party-read'>;
  }
}

const runtime = {
  range: { startUtc: '2026-08-01T00:00:00Z', endUtc: '2026-08-02T00:00:00Z' },
  localOccurrences: [],
};

describe('calendarProjectionRegistry', () => {
  it('supports empty composition and includes its own descriptor without a closed-world count', async () => {
    expect(() => { validateCalendarProjectionDescriptors([]); }).not.toThrow();
    expect(await composeCalendarReadProjections(runtime, [])).toEqual([]);
    expect(calendarProjectionRegistry).toContain(canonicalLocalCalendarProjection);
  });

  it('composes a genuine typed third contribution in stable order', async () => {
    const third: CalendarProjectionDescriptor<'third-party-read'> = {
      id: 'third-party-read',
      order: 300,
      source: 'external-read-only',
      isEnabled: () => true,
      load: () => Promise.resolve([{
        occurrenceKey: 'third@2026-08-01T12:00:00Z', source: 'external-read-only', sourceEventId: 'opaque-1',
        calendarId: 'calendar:external', title: 'External event', startUtc: '2026-08-01T12:00:00Z',
        endUtc: '2026-08-01T12:30:00Z', allDay: false, status: 'scheduled',
      }]),
    };
    const result = await composeCalendarReadProjections(runtime, [...calendarProjectionRegistry, third]);
    expect(result).toMatchObject([{ occurrenceKey: 'third@2026-08-01T12:00:00Z', source: 'external-read-only' }]);
  });

  it('excludes dark descriptors before loading and rejects duplicates, malformed entries, and order drift', async () => {
    const load = vi.fn(() => Promise.resolve([]));
    const dark: CalendarProjectionDescriptor<'third-party-read'> = {
      id: 'third-party-read', order: 300, source: 'external-read-only', isEnabled: () => false, load,
    };
    await expect(composeCalendarReadProjections(runtime, [...calendarProjectionRegistry, dark])).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(() => { validateCalendarProjectionDescriptors([
      canonicalLocalCalendarProjection,
      { ...canonicalLocalCalendarProjection },
    ]); }).toThrow(/duplicate/);
    expect(() => { validateCalendarProjectionDescriptors([
      { ...canonicalLocalCalendarProjection, id: ' bad' } as unknown as CalendarProjectionDescriptor,
    ]); }).toThrow(/invalid/);
    expect(() => { validateCalendarProjectionDescriptors([
      dark,
      canonicalLocalCalendarProjection,
    ]); }).toThrow(/increasing order/);
  });
});
