// Thin wrappers around the read-only Jotform Tauri commands.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { JotformMatterMapEntry } from '@/platform/rag/matterResolver';

export const JOTFORM_SYNC_EVENT = 'jotform-sync-progress';

export interface JotformConnectInfo {
  username: string;
  name: string;
  email: string;
}

export interface JotformForm {
  formId: string;
  title: string;
  status: string;
  updatedAt: string;
}

export interface JotformSyncReport {
  formsFetched: number;
  submissionsFetched: number;
  submissionsChanged: number;
  submissionsSkippedUnchanged: number;
  submissionsIndexed: number;
  recordsIndexed: number;
  needsAssignment: number;
  cancelled: boolean;
}

export type JotformSyncStatus = 'syncing' | 'done' | 'error' | 'cancelled';

export interface JotformSyncProgress {
  status: JotformSyncStatus;
  submissions?: number;
  records?: number;
  needsAssignment?: number;
}

export interface JotformDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  jotformDbPurged: boolean;
  dataRemains: boolean;
  warnings: string[];
}

export interface JotformUnassignedSubmission {
  sourceId: string;
  formId: string;
  submissionId: string;
  submitter: string;
  reason: string;
}

export async function jotformSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('jotform_set_workspace', { path });
}

export async function jotformConnect(apiKey: string): Promise<JotformConnectInfo> {
  if (!isTauri()) throw new Error('Jotform connect is only available in the desktop app.');
  return invoke<JotformConnectInfo>('jotform_connect', { apiKey });
}

export async function jotformIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('jotform_is_connected');
}

export async function jotformDisconnect(): Promise<JotformDisconnectResult> {
  if (!isTauri()) {
    return {
      tokenDeleted: false,
      ragPurged: false,
      jotformDbPurged: false,
      dataRemains: true,
      warnings: [],
    };
  }
  return invoke<JotformDisconnectResult>('jotform_disconnect');
}

export async function jotformListForms(): Promise<JotformForm[]> {
  if (!isTauri()) return [];
  return invoke<JotformForm[]>('jotform_list_forms');
}

export async function jotformSync(
  matterMap: JotformMatterMapEntry[],
): Promise<JotformSyncReport> {
  if (!isTauri()) throw new Error('Jotform sync is only available in the desktop app.');
  return invoke<JotformSyncReport>('jotform_sync', { matterMap });
}

export async function jotformCancel(): Promise<void> {
  if (!isTauri()) return;
  await invoke('jotform_cancel');
}

export async function jotformStatus(): Promise<{
  isSyncing: boolean;
  lastReport: JotformSyncReport | null;
}> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: JotformSyncReport | null }>('jotform_status');
}

export async function jotformListUnassigned(): Promise<JotformUnassignedSubmission[]> {
  if (!isTauri()) return [];
  return invoke<JotformUnassignedSubmission[]>('jotform_list_unassigned');
}
