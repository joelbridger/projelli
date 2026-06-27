// Thin wrappers around the read-only Calendly Tauri commands.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { MeetingMatterMapEntry } from '@/platform/rag/matterResolver';

export const CALENDLY_SYNC_EVENT = 'calendly-sync-progress';

export interface CalendlyConnectInfo {
  name: string;
  email: string;
  userUri: string;
  currentOrganization: string;
}

export interface CalendlySyncReport {
  eventsFetched: number;
  eventsChanged: number;
  inviteesFetched: number;
  meetingsIndexed: number;
  recordsIndexed: number;
}

export type CalendlySyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface CalendlySyncProgress {
  status: CalendlySyncEventStatus;
  meetings?: number;
  records?: number;
}

export interface CalendlyDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  calendlyDbPurged: boolean;
  dataRemains?: boolean;
  warnings: string[];
}

export async function calendlySetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('calendly_set_workspace', { path });
}

export async function calendlyConnect(token: string): Promise<CalendlyConnectInfo> {
  if (!isTauri()) throw new Error('Calendly connect is only available in the desktop app.');
  return invoke<CalendlyConnectInfo>('calendly_connect', { token });
}

export async function calendlyIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('calendly_is_connected');
}

export async function calendlyDisconnect(): Promise<CalendlyDisconnectResult> {
  if (!isTauri()) {
    return {
      tokenDeleted: false,
      ragPurged: false,
      calendlyDbPurged: false,
      dataRemains: true,
      warnings: [],
    };
  }
  return invoke<CalendlyDisconnectResult>('calendly_disconnect');
}

export async function calendlySyncAll(
  matterMap: MeetingMatterMapEntry[],
): Promise<CalendlySyncReport> {
  if (!isTauri()) throw new Error('Calendly sync is only available in the desktop app.');
  return invoke<CalendlySyncReport>('calendly_sync_all', { matterMap });
}

export async function calendlySyncStatus(): Promise<{
  isSyncing: boolean;
  lastReport: CalendlySyncReport | null;
}> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: CalendlySyncReport | null }>(
    'calendly_sync_status',
  );
}

export async function calendlyCancelSync(): Promise<void> {
  if (!isTauri()) return;
  await invoke('calendly_cancel_sync');
}
