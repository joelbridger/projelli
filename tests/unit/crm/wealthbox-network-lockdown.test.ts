import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: tauri.invoke,
}));

import {
  crmApproveWriteProposal,
  crmConnect,
  crmConnectWithCredentials,
  crmListHouseholds,
  crmMigrationImport,
  crmOAuthConnect,
  crmSyncAll,
} from '@/platform/utils/wealthbox-commands';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('Wealthbox Network Lockdown boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue({
      name: 'Northcrest',
      plan: 'Basic',
      email: 'advisor@example.com',
    });
    useSettingsStore.getState().setSetting(
      CONFIDENTIALITY_MODE_SETTING_KEY,
      'local-only',
    );
  });

  it('blocks connect before the native Wealthbox command can reach the network', async () => {
    await expect(crmConnect('secret-test-token')).rejects.toThrow(
      /network lockdown is on/i,
    );
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('blocks every public CRM network entry point before native code runs', async () => {
    const attempts = [
      () => crmConnectWithCredentials('redtail', 'advisor', 'password'),
      () => crmOAuthConnect('salesforce'),
      () => crmListHouseholds('run-1'),
      () => crmSyncAll([], 'run-1'),
      () => crmApproveWriteProposal('proposal-1'),
      () => crmMigrationImport({ baseUrl: 'http://127.0.0.1:8788/v1' }),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(/network lockdown is on/i);
    }
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('keeps every public CRM network entry point working when lockdown is off', async () => {
    useSettingsStore.getState().setSetting(
      CONFIDENTIALITY_MODE_SETTING_KEY,
      'direct',
    );

    await crmConnect('secret-test-token');
    await crmConnectWithCredentials('redtail', 'advisor', 'password');
    await crmOAuthConnect('salesforce');
    await crmListHouseholds('run-1');
    await crmSyncAll([], 'run-1');
    await crmApproveWriteProposal('proposal-1');
    await crmMigrationImport({ baseUrl: 'http://127.0.0.1:8788/v1' });

    expect(tauri.invoke.mock.calls.map(([command]) => command)).toEqual([
      'crm_connect',
      'crm_connect',
      'crm_oauth_connect',
      'crm_list_households',
      'crm_sync_all',
      'crm_approve_write_proposal',
      'crm_migration_import',
    ]);
  });
});
