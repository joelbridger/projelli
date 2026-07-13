import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  enforcedOffline: false,
  generation: 1,
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

const PUBLIC_CRM_ATTEMPTS = [
  () => crmConnectWithCredentials('redtail', 'advisor', 'password'),
  () => crmOAuthConnect('salesforce'),
  () => crmListHouseholds('run-1'),
  () => crmSyncAll([], 'run-1'),
  () => crmApproveWriteProposal('proposal-1'),
  () => crmMigrationImport({ baseUrl: 'http://127.0.0.1:8788/v1' }),
];

describe('Wealthbox Network Lockdown boundary', () => {
  beforeEach(() => {
    localStorage.clear();
    tauri.invoke.mockReset();
    tauri.enforcedOffline = false;
    tauri.generation = 1;
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'network_policy_status') {
        return {
          offlineMode: tauri.enforcedOffline,
          generation: tauri.generation,
          hydrated: true,
          loadError: null,
        };
      }
      return {
        name: 'Northcrest',
        plan: 'Basic',
        email: 'advisor@example.com',
      };
    });
    useSettingsStore.getState().setSetting(
      CONFIDENTIALITY_MODE_SETTING_KEY,
      'direct',
    );
  });

  it('BUG-19 ENGAGE: blocks every public CRM entry point from the enforced native state', async () => {
    tauri.enforcedOffline = true;

    for (const attempt of PUBLIC_CRM_ATTEMPTS) {
      await expect(attempt()).rejects.toThrow(/network lockdown is on/i);
    }

    expect(
      tauri.invoke.mock.calls.every(([command]) => command === 'network_policy_status'),
    ).toBe(true);
  });

  it('FINDING-20: does not block from a stale saved choice when native enforcement is off', async () => {
    useSettingsStore.getState().setSetting(
      CONFIDENTIALITY_MODE_SETTING_KEY,
      'local-only',
    );

    await crmConnect('secret-test-token');

    expect(tauri.invoke.mock.calls.map(([command]) => command)).toEqual([
      'network_policy_status',
      'crm_connect',
    ]);
  });

  it('keeps every public CRM network entry point working when native enforcement is off', async () => {
    await crmConnect('secret-test-token');
    for (const attempt of PUBLIC_CRM_ATTEMPTS) await attempt();

    expect(
      tauri.invoke.mock.calls
        .map(([command]) => command)
        .filter((command) => command !== 'network_policy_status'),
    ).toEqual([
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
