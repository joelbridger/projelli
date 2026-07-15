import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CalendarEventDto } from './types';

export const CALENDAR_EVENTS_SEED_KEY = 'lantern:__marketing_capture_calendar_events';

export async function calendarListEvents(fromUtc: string, toUtc: string): Promise<CalendarEventDto[]> {
  if (import.meta.env['VITE_MARKETING_CAPTURE'] === '1') {
    try {
      const raw = localStorage.getItem(CALENDAR_EVENTS_SEED_KEY);
      if (raw) return JSON.parse(raw) as CalendarEventDto[];
    } catch {
      // Fall through to the desktop calendar read.
    }
  }
  if (!isTauri()) return [];
  return invoke<CalendarEventDto[]>('calendar_list_events', { fromUtc, toUtc });
}
