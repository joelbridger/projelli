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
  /** Files written into a client's workspace folder (visible in Documents). */
  imported: number;
  indexed: number;
  skippedUnchanged: number;
  removed: number;
  pendingPdf: number;
  unsupported: number;
  repaired: number;
  deltaReset: boolean;
  cancelled: boolean;
}

/**
 * Result returned by `onedrive_disconnect`. Each boolean reflects whether
 * that purge step actually completed. When either is false the corresponding
 * data may still be on disk; `warnings` carries the human-readable reason(s).
 * Mirrors `CrmDisconnectResult` (wealthbox-commands.ts).
 */
export interface OneDriveDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  localDataPurged: boolean;
  /**
   * True when imported OneDrive data could NOT be fully removed and may still
   * be on disk (e.g. no workspace was open, or a purge step failed). The
   * backend keeps the saved connection when this is true so the user can
   * retry; the UI surfaces a "Finish deleting local data" action.
   */
  dataRemains: boolean;
  warnings: string[];
}

export type OneDriveSyncEventStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface OneDriveSyncProgress {
  status: OneDriveSyncEventStatus;
  seen?: number;
  imported?: number;
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

/** Abort a pending oneDriveConnect() sign-in immediately (user clicked Cancel,
 *  or closed the Microsoft popup and gave up) instead of leaving it to hit the
 *  5-minute server-side timeout. No-op outside Tauri. Never touches an
 *  already-working connection. */
export async function oneDriveConnectCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('onedrive_connect_cancel');
}

export async function oneDriveIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('onedrive_is_connected');
}

/**
 * Disconnect OneDrive. `deleteFiles` is the user's opt-in choice: when true the
 * files already imported into client folders are deleted too; when false
 * (default) those files STAY in the workspace and only the connection + search
 * index are removed.
 */
export async function oneDriveDisconnect(deleteFiles = false): Promise<OneDriveDisconnectResult> {
  if (!isTauri()) {
    return { tokenDeleted: false, ragPurged: false, localDataPurged: false, dataRemains: true, warnings: [] };
  }
  return invoke<OneDriveDisconnectResult>('onedrive_disconnect', { deleteFiles });
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
