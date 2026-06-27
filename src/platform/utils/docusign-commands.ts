import { invoke, isTauri } from '@tauri-apps/api/core';
import type { EsignMatterMapEntry } from '@/platform/rag/matterResolver';

export const DOCUSIGN_SYNC_EVENT = 'docusign-sync-progress';

export interface DocusignConnectInfo {
  accountId: string;
  accountName: string;
  baseUri: string;
  environment: string;
}

export interface DocusignSyncReport {
  envelopesFetched: number;
  envelopesChanged: number;
  envelopesSkippedUnchanged: number;
  auditEvents: number;
  recordsIndexed: number;
  needsAssignment: number;
  cancelled: boolean;
  pdfBodyExtraction: string;
}

export interface DocusignSyncProgress {
  status: 'syncing' | 'done' | 'error' | 'cancelled';
  records?: number;
  needsAssignment?: number;
}

export interface DocusignDisconnectResult {
  tokenDeleted: boolean;
  ragPurged: boolean;
  dbPurged: boolean;
  dataRemains: boolean;
  warnings: string[];
}

export interface DocusignUnassignedEnvelope {
  sourceId: string;
  envelopeId: string;
  subject: string;
  reason: string;
}

export async function docusignSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('docusign_set_workspace', { path });
}

export async function docusignConnect(): Promise<DocusignConnectInfo> {
  if (!isTauri()) throw new Error('DocuSign connect is only available in the desktop app.');
  return invoke<DocusignConnectInfo>('docusign_connect');
}

export async function docusignIsConnected(): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('docusign_is_connected');
}

export async function docusignDisconnect(): Promise<DocusignDisconnectResult> {
  if (!isTauri()) {
    return { tokenDeleted: false, ragPurged: false, dbPurged: false, dataRemains: true, warnings: [] };
  }
  return invoke<DocusignDisconnectResult>('docusign_disconnect');
}

export async function docusignSync(
  matterMap: EsignMatterMapEntry[],
  fromDate?: string,
  toDate?: string,
): Promise<DocusignSyncReport> {
  if (!isTauri()) throw new Error('DocuSign sync is only available in the desktop app.');
  return invoke<DocusignSyncReport>('docusign_sync', { matterMap, fromDate, toDate });
}

export async function docusignCancelSync(): Promise<void> {
  if (!isTauri()) return;
  await invoke('docusign_cancel_sync');
}

export async function docusignSyncStatus(): Promise<{
  isSyncing: boolean;
  lastReport: DocusignSyncReport | null;
}> {
  if (!isTauri()) return { isSyncing: false, lastReport: null };
  return invoke<{ isSyncing: boolean; lastReport: DocusignSyncReport | null }>('docusign_sync_status');
}

export async function docusignListUnassigned(): Promise<DocusignUnassignedEnvelope[]> {
  if (!isTauri()) return [];
  return invoke<DocusignUnassignedEnvelope[]>('docusign_list_unassigned');
}
