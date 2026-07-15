/**
 * The stable renderer boundary for CRM record deletion and recovery.
 *
 * Future CRM delete affordances call `softDeleteCrmRecord` instead of writing
 * their own tombstones. The native service owns the atomic mutation and the
 * 30-day expiry; this client only scopes calls to the active CRM workspace.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
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
  actorId: string;
}

async function inTrashWorkspace<T>(
  workspaceRoot: string | null | undefined,
  operation: () => Promise<T>,
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
export function softDeleteCrmRecord({ workspaceRoot, recordId, actorId }: TrashRequest) {
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord>('crm_trash_soft_delete', {
      recordId,
      deletedBy: actorId,
    }),
  );
}

export function listTrashedCrmRecords(workspaceRoot: string | null | undefined) {
  if (!isTauri() || !workspaceRoot) return Promise.resolve<readonly TrashedCrmRecord[]>([]);
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord[]>('crm_trash_list'),
  );
}

export function restoreTrashedCrmRecord({ workspaceRoot, recordId, actorId }: TrashRequest) {
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<TrashedCrmRecord>('crm_trash_restore', {
      recordId,
      restoredBy: actorId,
    }),
  );
}

/** Native authority denies this until the teams-roles contract is landed. */
export function permanentlyPurgeTrashedCrmRecord({ workspaceRoot, recordId, actorId }: TrashRequest) {
  return inTrashWorkspace(workspaceRoot, () =>
    invoke<void>('crm_trash_purge', { recordId, actorId }),
  );
}
