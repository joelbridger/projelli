// Thin wrappers around the calendar connector's Tauri commands.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CalendarMatterMapEntry } from '@/platform/rag/matterResolver';

export const CALENDAR_SYNC_EVENT = 'calendar-sync-progress';

export type CalendarProviderId = 'outlook' | 'google' | 'ics';

export interface CalendarAttendeeDto {
  email: string;
  name: string;
}

export interface CalendarEventDto {
  id: string;
  provider: CalendarProviderId;
  title: string;
  startUtc: string;
  endUtc: string;
  attendees: CalendarAttendeeDto[];
  organizerEmail: string;
}

export interface CalendarSyncReport {
  eventsFetched: number;
  eventsChanged: number;
  eventsIndexed: number;
  recordsIndexed: number;
  cancelled: boolean;
}

export interface CalendarSyncStatus {
  syncing: boolean;
  eventsIndexed: number;
  lastReport: CalendarSyncReport | null;
}

export interface CalendarSyncProgress {
  status: 'syncing' | 'done' | 'cancelled' | 'error';
  eventsIndexed: number;
  error?: string;
}

const DESKTOP_ONLY = 'Calendar sync is only available in the desktop app.';

export async function calendarSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  return invoke('calendar_set_workspace', { path });
}

export async function calendarConnectOutlook(): Promise<void> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke('calendar_connect_outlook');
}

export async function calendarConnectOutlookCancel(): Promise<void> {
  if (!isTauri()) return;
  return invoke('calendar_connect_outlook_cancel');
}

export async function calendarConnectGoogle(): Promise<void> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke('calendar_connect_google');
}

export async function calendarConnectGoogleCancel(): Promise<void> {
  if (!isTauri()) return;
  return invoke('calendar_connect_google_cancel');
}

export async function calendarConnectIcs(url: string): Promise<void> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke('calendar_connect_ics', { url });
}

export async function calendarIsConnected(
  provider: CalendarProviderId
): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('calendar_is_connected', { provider });
}

export async function calendarDisconnect(
  provider: CalendarProviderId
): Promise<void> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke('calendar_disconnect', { provider });
}

export async function calendarSyncAll(
  matterMap: CalendarMatterMapEntry[]
): Promise<CalendarSyncReport> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke<CalendarSyncReport>('calendar_sync_all', { matterMap });
}

export async function calendarSyncStatus(): Promise<CalendarSyncStatus> {
  if (!isTauri()) return { syncing: false, eventsIndexed: 0, lastReport: null };
  return invoke<CalendarSyncStatus>('calendar_sync_status');
}

export async function calendarCancelSync(): Promise<void> {
  if (!isTauri()) return;
  return invoke('calendar_cancel_sync');
}

export async function calendarListEvents(
  fromUtc: string,
  toUtc: string
): Promise<CalendarEventDto[]> {
  if (!isTauri()) return [];
  return invoke<CalendarEventDto[]>('calendar_list_events', { fromUtc, toUtc });
}
