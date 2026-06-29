// Thin wrappers around the provisional read-only Zocks Tauri commands.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ZocksMatterMapEntry } from '@/platform/rag/matterResolver';

export const ZOCKS_SYNC_EVENT = 'zocks-sync-progress';

export interface ZocksConnectInfo {
  baseUrl: string;
  endpointStatus: string;
}

export interface ZocksSessionSummary {
  id: string;
  title: string;
  clientName: string;
  startedAt: string;
}

export interface ZocksSyncReport {
  sessionsFetched: number;
  sessionsChanged: number;
  sessionsIndexed: number;
  recordsIndexed: number;
  needsAssignment: number;
  /** Sessions skipped this sync due to repeated detail-fetch failures; retried next sync. */
  fetchFailures: number;
  cancelled: boolean;
}

export interface ZocksSyncProgress {
  status: 'syncing' | 'done' | 'error' | 'cancelled';
  sessions?: number;
  records?: number;
  needsAssignment?: number;
  fetchFailures?: number;
}

export interface ZocksDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  zocksDbPurged: boolean;
  dataRemains: boolean;
  warnings: string[];
}

export interface ZocksUnassignedSession {
  sourceId: string;
  sessionId: string;
  title: string;
  reason: string;
}

export async function zocksSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('zocks_set_workspace', { path });
}

export async function zocksConnect(apiKey: string): Promise<ZocksConnectInfo> {
  if (!isTauri()) throw new Error('Zocks connect is only available in the desktop app.');
  return invoke<ZocksConnectInfo>('zocks_connect', { apiKey });
}

export async function zocksIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('zocks_is_connected');
}

export async function zocksDisconnect(): Promise<ZocksDisconnectResult> {
  if (!isTauri()) {
    return {
      tokenDeleted: false,
      ragPurged: false,
      zocksDbPurged: false,
      dataRemains: true,
      warnings: [],
    };
  }
  return invoke<ZocksDisconnectResult>('zocks_disconnect');
}

export async function zocksListSessions(): Promise<ZocksSessionSummary[]> {
  if (!isTauri()) return [];
  return invoke<ZocksSessionSummary[]>('zocks_list_sessions');
}

export async function zocksSync(matterMap: ZocksMatterMapEntry[]): Promise<ZocksSyncReport> {
  if (!isTauri()) throw new Error('Zocks sync is only available in the desktop app.');
  return invoke<ZocksSyncReport>('zocks_sync', { matterMap });
}

export async function zocksCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('zocks_cancel');
}

export async function zocksStatus(): Promise<{
  isSyncing: boolean;
  lastReport: ZocksSyncReport | null;
}> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: ZocksSyncReport | null }>('zocks_status');
}

export async function zocksListUnassigned(): Promise<ZocksUnassignedSession[]> {
  if (!isTauri()) return [];
  return invoke<ZocksUnassignedSession[]>('zocks_list_unassigned');
}
