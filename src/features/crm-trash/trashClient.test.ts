import { describe, expect, it, vi } from 'vitest';
import {
  isCrmRecordTombstoned,
  permanentlyPurgeTrashedCrmRecord,
  restoreTrashedCrmRecord,
  softDeleteCrmRecord,
} from './trashClient';

const invoke = vi.fn();
const crmSetWorkspace = vi.fn();
const hydrate = vi.fn();
const logDurable = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  isTauri: () => true,
}));
vi.mock('@/platform/flags', () => ({ isEnabled: () => true }));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (...args: unknown[]) => crmSetWorkspace(...args),
}));
vi.mock('@/platform/audit/AuditService', () => ({
  AuditService: class {
    hydrate = (...args: unknown[]) => hydrate(...args);
    logDurable = (...args: unknown[]) => logDurable(...args);
  },
}));

const request = {
  workspaceRoot: '/crm-workspace',
  recordId: 'record-1',
  matterId: 'matter-1',
  actorId: 'advisor-1',
};

describe('trashClient', () => {
  it('uses the stable native soft-delete, recovery, and tombstone contract', async () => {
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
    expect(hydrate).toHaveBeenCalledWith('/crm-workspace');
    expect(logDurable).toHaveBeenCalledWith(
      'crm_record_soft_deleted',
      'CRM record moved to Trash & recovery',
      expect.objectContaining({
        metadata: expect.objectContaining({ recordId: 'record-1' }),
      })
    );
    expect(logDurable).toHaveBeenCalledWith(
      'crm_record_restored',
      'CRM record restored from Trash & recovery',
      expect.objectContaining({
        metadata: expect.objectContaining({ recordId: 'record-1' }),
      })
    );
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
    expect(logDurable).toHaveBeenCalledWith(
      'crm_record_purge_refused',
      'CRM permanent deletion refused',
      expect.objectContaining({
        metadata: expect.objectContaining({ actorId: 'advisor-1' }),
      })
    );
  });
});
