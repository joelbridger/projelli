import { beforeEach, describe, expect, it, vi } from 'vitest';

const controls = vi.hoisted(() => ({
  crmIsConnected: vi.fn(),
  crmRebuildStore: vi.fn(),
  crmSyncAll: vi.fn(),
  createCrmRunId: vi.fn(),
  getMatters: vi.fn(),
  buildCrmMatterMap: vi.fn(),
  filterCrmMatterMapForProvider: vi.fn(),
}));

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmIsConnected: controls.crmIsConnected,
  crmRebuildStore: controls.crmRebuildStore,
  crmSyncAll: controls.crmSyncAll,
  createCrmRunId: controls.createCrmRunId,
}));
vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: controls.getMatters,
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  buildCrmMatterMap: controls.buildCrmMatterMap,
  filterCrmMatterMapForProvider: controls.filterCrmMatterMapForProvider,
}));

import { rebuildConnectedCrmImports } from './crmRecovery';

describe('rebuildConnectedCrmImports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controls.crmIsConnected.mockResolvedValue(true);
    controls.crmRebuildStore.mockResolvedValue(undefined);
    controls.crmSyncAll.mockResolvedValue({ householdsProcessed: 1, recordsIndexed: 1 });
    controls.createCrmRunId
      .mockReturnValueOnce('wealthbox-recovery')
      .mockReturnValueOnce('salesforce-recovery')
      .mockReturnValueOnce('redtail-recovery');
    controls.getMatters.mockReturnValue([{ id: 'client-1' }]);
    controls.buildCrmMatterMap.mockReturnValue([{ matterId: 'client-1' }]);
    controls.filterCrmMatterMapForProvider.mockImplementation((_map, provider) => [
      { matterId: `${String(provider)}-client` },
    ]);
  });

  it('rebuilds every connected provider after replacing the unreadable shared store', async () => {
    await rebuildConnectedCrmImports();

    expect(controls.crmRebuildStore).toHaveBeenCalledTimes(1);
    expect(controls.crmSyncAll.mock.calls).toEqual([
      [[{ matterId: 'wealthbox-client' }], 'wealthbox-recovery', 'wealthbox'],
      [[{ matterId: 'salesforce-client' }], 'salesforce-recovery', 'salesforce'],
      [[{ matterId: 'redtail-client' }], 'redtail-recovery', 'redtail'],
    ]);
  });

  it('continues restoring other providers when one provider is temporarily offline', async () => {
    controls.crmSyncAll
      .mockRejectedValueOnce(new Error('Wealthbox is offline'))
      .mockResolvedValueOnce({ householdsProcessed: 1, recordsIndexed: 1 })
      .mockResolvedValueOnce({ householdsProcessed: 1, recordsIndexed: 1 });

    await expect(rebuildConnectedCrmImports()).rejects.toThrow(
      /Wealthbox could not be re-synced/i,
    );
    expect(controls.crmSyncAll).toHaveBeenCalledTimes(3);
  });
});
