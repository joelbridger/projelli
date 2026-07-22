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

// The Rust CRM commands retain the active workspace between calls. Keep the
// select-workspace + read/write pair together, so an older screen load cannot
// point the backend at one workspace while a newer load reads from another.
let workspaceOperation: Promise<void> = Promise.resolve();

function inCrmWorkspace<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
  const task = workspaceOperation
    .catch(() => undefined)
    .then(async () => {
      await crmSetWorkspace(workspaceRoot);
      return operation();
    });
  workspaceOperation = task.then(() => undefined, () => undefined);
  return task;
}

/**
 * Lowest-level encrypted collection read. Visibility migration consumes it
 * internally; only the meeting-preferences controller receives a raw snapshot.
 * User-facing stores, lists, search, Ask, and citations use the filtered CRM
 * boundary and must never expose this result directly.
 */
export async function loadLiveCrmRecords(workspaceRoot: string | null | undefined): Promise<readonly LiveCrmRecord[]> {
  if (!isTauri() || !workspaceRoot) return [];
  return inCrmWorkspace(workspaceRoot, () => invoke<LiveCrmRecord[]>('crm_live_list'));
}

export async function saveLiveCrmRecord(
  workspaceRoot: string | null | undefined,
  record: LiveCrmRecord,
): Promise<LiveCrmRecord> {
  if (!isTauri()) throw new Error('CRM records can only be saved in the desktop app.');
  if (!workspaceRoot) throw new Error('Open a workspace before saving CRM data.');
  return inCrmWorkspace(workspaceRoot, () => invoke<LiveCrmRecord>('crm_live_upsert', { record }));
}
