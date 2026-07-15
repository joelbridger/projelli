import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CalendarMatterMapEntry } from '@/platform/rag/matterResolver';
import type { CalendarProviderId, CalendarSyncReport, CalendarSyncStatus } from './types';

export const CALENDAR_SYNC_EVENT = 'calendar-sync-progress';
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
export async function calendarIsConnected(provider: CalendarProviderId): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('calendar_is_connected', { provider });
}
export async function calendarDisconnect(provider: CalendarProviderId): Promise<void> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY);
  return invoke('calendar_disconnect', { provider });
}
export async function calendarSyncAll(matterMap: CalendarMatterMapEntry[]): Promise<CalendarSyncReport> {
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
