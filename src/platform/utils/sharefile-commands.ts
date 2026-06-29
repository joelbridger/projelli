import { invoke, isTauri } from '@tauri-apps/api/core';
import type { SharefileMatterMapEntry } from '@/platform/rag/matterResolver';

export const SHAREFILE_SYNC_EVENT = 'sharefile-sync-progress';

export interface SharefileFolder {
  key: string;
  itemId: string;
  name: string;
  path: string;
}

export interface SharefileSyncReport {
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

export type SharefileSyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface SharefileSyncProgress {
  status: SharefileSyncEventStatus;
  seen?: number;
  indexed?: number;
  pendingPdf?: number;
}

export async function sharefileSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('sharefile_set_workspace', { path });
}

export async function sharefileConnect(
  accessToken: string,
  subdomain: string
): Promise<void> {
  if (!isTauri()) throw new Error('ShareFile connect is only available in the desktop app.');
  await invoke('sharefile_connect', { accessToken, subdomain });
}

export async function sharefileIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('sharefile_is_connected');
}

export async function sharefileDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('sharefile_disconnect');
}

export async function sharefileListFolders(): Promise<SharefileFolder[]> {
  if (!isTauri()) return [];
  return invoke<SharefileFolder[]>('sharefile_list_folders');
}

export async function sharefileSync(
  matterMap: SharefileMatterMapEntry[] = []
): Promise<SharefileSyncReport> {
  if (!isTauri()) throw new Error('ShareFile sync is only available in the desktop app.');
  return invoke<SharefileSyncReport>('sharefile_sync', { matterMap });
}

export async function sharefileCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('sharefile_cancel');
}

export async function sharefileStatus(): Promise<{ isSyncing: boolean; lastReport: SharefileSyncReport | null }> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: SharefileSyncReport | null }>('sharefile_status');
}
