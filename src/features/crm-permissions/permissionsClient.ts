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
  /**
   * The current member is resolved natively from the authenticated firm
   * session (established by the SSO exchange), NOT from the renderer. There is
   * deliberately no `setCurrentMember`: the renderer cannot assume an identity.
   */
  getCurrentMember: () => {
    if (!isTauri())
      throw new Error('CRM permissions are available only in the desktop app.');
    return invoke<CurrentMember | null>('crm_permissions_get_current_member');
  },
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
