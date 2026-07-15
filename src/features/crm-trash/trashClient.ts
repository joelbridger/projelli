/**
 * The stable renderer boundary for CRM record deletion and recovery.
 *
 * Future CRM delete affordances call `softDeleteCrmRecord` instead of writing
 * their own tombstones. The native service owns the atomic mutation and the
 * 30-day expiry; this client only scopes calls to the active CRM workspace.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import { isEnabled } from '@/platform/flags';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';

export interface TrashedCrmRecord {
  recordId: string;
  recordType: string;
  matterId: string;
  record: Record<string, unknown>;
  deletedAt: string;
  deletedBy: string;
  expiresAt: string;
}

interface TrashRequest {
  workspaceRoot: string | null | undefined;
  recordId: string;
  matterId: string;
  actorId: string;
}

function notifyLiveCrmSubscribers(): void {
  window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
}

async function inTrashWorkspace<T>(
  workspaceRoot: string | null | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!isEnabled('crm-trash-recovery')) {
    throw new Error('CRM trash and recovery is not enabled.');
  }
  if (!isTauri()) {
    throw new Error('CRM trash and recovery is available in the desktop app.');
  }
  if (!workspaceRoot) {
    throw new Error('Open a workspace before changing CRM records.');
  }
  await crmSetWorkspace(workspaceRoot);
  return operation();
}

/** The sole frontend soft-delete entry point for future CRM delete lanes. */
export async function softDeleteCrmRecord({
  workspaceRoot,
  recordId,
  matterId,
  actorId,
}: TrashRequest) {
  const deleted = await inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord>('crm_trash_soft_delete', {
      recordId,
      matterId,
      deletedBy: actorId,
    })
  );
  notifyLiveCrmSubscribers();
  return deleted;
}

/** Lets future connector/import clients honor a still-recoverable deletion. */
export function isCrmRecordTombstoned({
  workspaceRoot,
  recordId,
  matterId,
}: Omit<TrashRequest, 'actorId'>) {
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<boolean>('crm_trash_is_tombstoned', { recordId, matterId })
  );
}

export function listTrashedCrmRecords(
  workspaceRoot: string | null | undefined
) {
  if (!isTauri() || !workspaceRoot)
    return Promise.resolve<readonly TrashedCrmRecord[]>([]);
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord[]>('crm_trash_list')
  );
}

export async function restoreTrashedCrmRecord({
  workspaceRoot,
  recordId,
  matterId,
  actorId,
}: TrashRequest) {
  const restored = await inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord>('crm_trash_restore', {
      recordId,
      matterId,
      restoredBy: actorId,
    })
  );
  notifyLiveCrmSubscribers();
  return restored;
}

/** Native authority denies this until the teams-roles contract is landed. */
export async function permanentlyPurgeTrashedCrmRecord({
  workspaceRoot,
  recordId,
  matterId,
  actorId,
}: TrashRequest) {
  await inTrashWorkspace(workspaceRoot, () =>
    invoke('crm_trash_purge', { recordId, matterId, actorId })
  );
  notifyLiveCrmSubscribers();
}
