import type { CalendarProjectionDescriptor, CalendarReadProjection } from '@/features/calendar';

declare module '@/features/calendar' {
  interface CalendarProjectionMap {
    'fixture-versioned-read': CalendarProjectionDescriptor<'fixture-versioned-read'>;
  }
}

export const fixtureVersionedRead: CalendarProjectionDescriptor<'fixture-versioned-read'> = {
  id: 'fixture-versioned-read',
  order: 900,
  source: 'external-read-only',
  isEnabled: () => false,
  load: (): Promise<readonly CalendarReadProjection[]> => Promise.resolve([]),
};
