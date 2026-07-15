import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isCrmRecordTombstoned,
  permanentlyPurgeTrashedCrmRecord,
  restoreTrashedCrmRecord,
  softDeleteCrmRecord,
} from './trashClient';
import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';

const invoke = vi.fn<
  (command: string, args?: Record<string, unknown>) => Promise<unknown>
>();
const crmSetWorkspace = vi.fn<(workspaceRoot: string) => Promise<void>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) =>
    invoke(command, args),
  isTauri: () => true,
}));
vi.mock('@/platform/flags', () => ({ isEnabled: () => true }));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (workspaceRoot: string) => crmSetWorkspace(workspaceRoot),
}));

const request = {
  workspaceRoot: '/crm-workspace',
  recordId: 'record-1',
  matterId: 'matter-1',
  actorId: 'advisor-1',
};

describe('trashClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the stable native soft-delete, recovery, and tombstone contract', async () => {
    const changed = vi.fn();
    window.addEventListener(LIVE_CRM_RECORDS_CHANGED, changed);
    invoke.mockResolvedValue({ expiresAt: '2026-08-14T12:00:00Z' });

    await softDeleteCrmRecord(request);
    await restoreTrashedCrmRecord(request);
    await isCrmRecordTombstoned(request);

    expect(crmSetWorkspace).toHaveBeenCalledWith('/crm-workspace');
    expect(invoke).toHaveBeenNthCalledWith(1, 'crm_trash_soft_delete', {
      recordId: 'record-1',
      matterId: 'matter-1',
      deletedBy: 'advisor-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'crm_trash_restore', {
      recordId: 'record-1',
      matterId: 'matter-1',
      restoredBy: 'advisor-1',
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'crm_trash_is_tombstoned', {
      recordId: 'record-1',
      matterId: 'matter-1',
    });
    expect(changed).toHaveBeenCalledTimes(2);
    window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, changed);
  });

  it('passes the actor only to the native firm-admin purge boundary', async () => {
    invoke.mockRejectedValue(
      new Error('Permanent CRM deletion requires a firm admin')
    );

    await expect(permanentlyPurgeTrashedCrmRecord(request)).rejects.toThrow(
      'requires a firm admin'
    );

    expect(invoke).toHaveBeenCalledWith('crm_trash_purge', {
      recordId: 'record-1',
      matterId: 'matter-1',
      actorId: 'advisor-1',
    });
  });
});
