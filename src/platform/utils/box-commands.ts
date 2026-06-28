import { invoke, isTauri } from '@tauri-apps/api/core';
import type { BoxMatterMapEntry } from '@/platform/rag/matterResolver';

export const BOX_SYNC_EVENT = 'box-sync-progress';

export interface BoxFolder {
  key: string;
  folderId: string;
  name: string;
  path: string;
}

export interface BoxSyncReport {
  seen: number;
  downloaded: number;
  indexed: number;
  skippedUnchanged: number;
  removed: number;
  pendingPdf: number;
  unsupported: number;
  repaired: number;
  cancelled: boolean;
}

export type BoxSyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface BoxSyncProgress {
  status: BoxSyncEventStatus;
  seen?: number;
  indexed?: number;
  pendingPdf?: number;
}

export interface BoxStatusDto {
  isSyncing: boolean;
  lastReport: BoxSyncReport | null;
}

export async function boxSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('box_set_workspace', { path });
}

export async function boxConnect(accessToken: string): Promise<void> {
  if (!isTauri()) throw new Error('Box connect is only available in the desktop app.');
  await invoke('box_connect', { accessToken });
}

export async function boxIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('box_is_connected');
}

export async function boxDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('box_disconnect');
}

export async function boxListFolders(): Promise<BoxFolder[]> {
  if (!isTauri()) return [];
  return invoke<BoxFolder[]>('box_list_folders');
}

export async function boxSync(
  matterMap: BoxMatterMapEntry[] = []
): Promise<BoxSyncReport> {
  if (!isTauri()) throw new Error('Box sync is only available in the desktop app.');
  return invoke<BoxSyncReport>('box_sync', { matterMap });
}

export async function boxCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('box_cancel');
}

export async function boxStatus(): Promise<BoxStatusDto> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<BoxStatusDto>('box_status');
}
