/**
 * The stable renderer boundary for CRM record deletion and recovery.
 *
 * Future CRM delete affordances call `softDeleteCrmRecord` instead of writing
 * their own tombstones. The native service owns the atomic mutation and the
 * 30-day expiry; this client only scopes calls to the active CRM workspace.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { AuditService } from '@/platform/audit/AuditService';
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

type TrashAuditAction =
  | 'crm_record_soft_deleted'
  | 'crm_record_restored'
  | 'crm_record_purge_refused';

async function logTrashAction(
  workspaceRoot: string | null | undefined,
  action: TrashAuditAction,
  description: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const audit = new AuditService();
  await audit.hydrate(workspaceRoot ?? undefined);
  await audit.logDurable(action, description, { metadata });
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
  await logTrashAction(
    workspaceRoot,
    'crm_record_soft_deleted',
    'CRM record moved to Trash & recovery',
    {
      recordId,
      matterId,
      deletedBy: actorId,
      expiresAt: deleted.expiresAt,
    }
  );
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
  await logTrashAction(
    workspaceRoot,
    'crm_record_restored',
    'CRM record restored from Trash & recovery',
    {
      recordId,
      matterId,
      restoredBy: actorId,
    }
  );
  return restored;
}

/** Native authority denies this until the teams-roles contract is landed. */
export async function permanentlyPurgeTrashedCrmRecord({
  workspaceRoot,
  recordId,
  matterId,
  actorId,
}: TrashRequest) {
  try {
    await inTrashWorkspace(workspaceRoot, () =>
      invoke<void>('crm_trash_purge', { recordId, matterId, actorId })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('requires a firm admin')) {
      await logTrashAction(
        workspaceRoot,
        'crm_record_purge_refused',
        'CRM permanent deletion refused',
        {
          recordId,
          matterId,
          actorId,
        }
      );
    }
    throw error;
  }
}
