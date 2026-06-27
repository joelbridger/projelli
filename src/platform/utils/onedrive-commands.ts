import { invoke, isTauri } from '@tauri-apps/api/core';
import type { OneDriveMatterMapEntry } from '@/platform/rag/matterResolver';

export const ONEDRIVE_SYNC_EVENT = 'onedrive-sync-progress';

export interface OneDriveDrive {
  id: string;
  name: string;
  webUrl?: string | null;
  driveType?: string | null;
}

export interface OneDriveFolder {
  key: string;
  driveId: string;
  siteId?: string | null;
  itemId: string;
  name: string;
  path: string;
}

export interface OneDriveSyncReport {
  seen: number;
  downloaded: number;
  indexed: number;
  skippedUnchanged: number;
  removed: number;
  pendingPdf: number;
  unsupported: number;
  repaired: number;
  deltaReset: boolean;
  cancelled: boolean;
}

export type OneDriveSyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface OneDriveSyncProgress {
  status: OneDriveSyncEventStatus;
  seen?: number;
  indexed?: number;
  pendingPdf?: number;
}

export async function oneDriveSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('onedrive_set_workspace', { path });
}

export async function oneDriveConnect(): Promise<void> {
  if (!isTauri()) throw new Error('OneDrive connect is only available in the desktop app.');
  await invoke('onedrive_connect');
}

export async function oneDriveIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('onedrive_is_connected');
}

export async function oneDriveDisconnect(): Promise<void> {
  if (!isTauri()) return;
  await invoke('onedrive_disconnect');
}

export async function oneDriveListDrives(): Promise<OneDriveDrive[]> {
  if (!isTauri()) return [];
  return invoke<OneDriveDrive[]>('onedrive_list_drives');
}

export async function oneDriveListFolders(): Promise<OneDriveFolder[]> {
  if (!isTauri()) return [];
  return invoke<OneDriveFolder[]>('onedrive_list_folders');
}

export async function oneDriveSync(matterMap: OneDriveMatterMapEntry[] = []): Promise<OneDriveSyncReport> {
  if (!isTauri()) throw new Error('OneDrive sync is only available in the desktop app.');
  return invoke<OneDriveSyncReport>('onedrive_sync', { matterMap });
}

export async function oneDriveCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('onedrive_cancel');
}

export async function oneDriveStatus(): Promise<{ isSyncing: boolean; lastReport: OneDriveSyncReport | null }> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: OneDriveSyncReport | null }>('onedrive_status');
}
