import { invoke, isTauri } from '@tauri-apps/api/core';
import type { AddeparMatterMapEntry } from '@/platform/rag/matterResolver';

export const ADDEPAR_SYNC_EVENT = 'addepar-sync-progress';

export interface AddeparConnectInfo {
  subdomain: string;
  firmId: string;
}

export interface AddeparEntityDto {
  id: string;
  name: string;
  modelType: string;
}

export interface AddeparSyncReport {
  entitiesFetched: number;
  householdsProcessed: number;
  recordsIndexed: number;
  needsAssignment: number;
  cancelled: boolean;
}

export interface AddeparSyncProgress {
  status: 'syncing' | 'done' | 'error' | 'cancelled';
  households?: number;
  records?: number;
  needsAssignment?: number;
}

export interface AddeparDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  dataRemains: boolean;
  warnings: string[];
}

export async function addeparSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('addepar_set_workspace', { path });
}

export async function addeparConnect(
  apiKey: string,
  apiSecret: string,
  subdomain: string,
  firmId: string,
): Promise<AddeparConnectInfo> {
  if (!isTauri()) throw new Error('Addepar connect is only available in the desktop app.');
  return invoke<AddeparConnectInfo>('addepar_connect', {
    apiKey,
    apiSecret,
    subdomain,
    firmId,
  });
}

export async function addeparIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('addepar_is_connected');
}

export async function addeparDisconnect(): Promise<AddeparDisconnectResult> {
  if (!isTauri()) {
    return { tokenDeleted: false, ragPurged: false, dataRemains: true, warnings: [] };
  }
  return invoke<AddeparDisconnectResult>('addepar_disconnect');
}

export async function addeparListEntities(): Promise<AddeparEntityDto[]> {
  if (!isTauri()) return [];
  return invoke<AddeparEntityDto[]>('addepar_list_entities');
}

export async function addeparSync(
  matterMap: AddeparMatterMapEntry[],
): Promise<AddeparSyncReport> {
  if (!isTauri()) throw new Error('Addepar sync is only available in the desktop app.');
  return invoke<AddeparSyncReport>('addepar_sync', { matterMap });
}

export async function addeparCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('addepar_cancel');
}

export async function addeparStatus(): Promise<{
  isSyncing: boolean;
  lastReport: AddeparSyncReport | null;
}> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: AddeparSyncReport | null }>('addepar_status');
}
