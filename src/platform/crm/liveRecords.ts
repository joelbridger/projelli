/**
 * The screen-level CRM record boundary.  It intentionally has no localStorage
 * fallback: a running desktop app reads and writes the SQLCipher CRM core.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';

export type LiveCrmRecord = {
  id: string;
  kind: string;
  matterId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export async function loadLiveCrmRecords(workspaceRoot: string | null | undefined): Promise<readonly LiveCrmRecord[]> {
  if (!isTauri() || !workspaceRoot) return [];
  await crmSetWorkspace(workspaceRoot);
  return invoke<LiveCrmRecord[]>('crm_live_list');
}

export async function saveLiveCrmRecord(
  workspaceRoot: string | null | undefined,
  record: LiveCrmRecord,
): Promise<LiveCrmRecord> {
  if (!isTauri()) throw new Error('CRM records can only be saved in the desktop app.');
  if (!workspaceRoot) throw new Error('Open a workspace before saving CRM data.');
  await crmSetWorkspace(workspaceRoot);
  return invoke<LiveCrmRecord>('crm_live_upsert', { record });
}
