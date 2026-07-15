import { invoke, isTauri } from '@tauri-apps/api/core';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export interface CurrentMember {
  memberId: string;
}

async function inCrmWorkspace<T>(
  workspaceRoot: string | null | undefined,
  command: string,
  payload?: Record<string, unknown>
): Promise<T> {
  if (!isTauri())
    throw new Error('CRM permissions are available only in the desktop app.');
  if (!workspaceRoot) throw new Error('Open a workspace before using CRM data.');
  await crmSetWorkspace(workspaceRoot);
  return invoke<T>(command, payload);
}

/** Native authority client; no method accepts a caller/member identity. */
export const permissionsClient = {
  getCurrentMember: (workspaceRoot: string | null | undefined) =>
    inCrmWorkspace<CurrentMember | null>(
      workspaceRoot,
      'crm_permissions_get_current_member'
    ),
  setCurrentMember: (
    workspaceRoot: string | null | undefined,
    memberId: string
  ) =>
    inCrmWorkspace<CurrentMember>(
      workspaceRoot,
      'crm_permissions_set_current_member',
      { memberId }
    ),
  list: (workspaceRoot: string | null | undefined) =>
    inCrmWorkspace<readonly LiveCrmRecord[]>(
      workspaceRoot,
      'crm_permissions_list'
    ),
  getRecord: (workspaceRoot: string | null | undefined, recordId: string) =>
    inCrmWorkspace<LiveCrmRecord>(
      workspaceRoot,
      'crm_permissions_get_record',
      { recordId }
    ),
  upsert: (workspaceRoot: string | null | undefined, record: LiveCrmRecord) =>
    inCrmWorkspace<LiveCrmRecord>(workspaceRoot, 'crm_permissions_upsert', {
      record,
    }),
};
