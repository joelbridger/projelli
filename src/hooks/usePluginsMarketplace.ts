/**
 * usePluginsMarketplace — React hook over the plugins marketplace store.
 *
 * Returns the workspace-bound plugins `MarketplaceService` plus the latest
 * `cacheStatus` and `updateCount`. Consumers under
 * `src/components/marketplace/` use this rather than reading App refs.
 *
 * The store is seeded by App.tsx on workspace select. Until a workspace is
 * loaded, `service` is `null` and components should render an empty /
 * "select a workspace" state.
 */

import { usePluginsMarketplaceStore } from '@/stores/pluginsMarketplaceStore';
import type { MarketplaceService, CacheStatus } from '@/modules/marketplace';

export interface UsePluginsMarketplaceResult {
  service: MarketplaceService | null;
  cacheStatus: CacheStatus;
  updateCount: number;
  setCacheStatus: (status: CacheStatus) => void;
  setUpdateCount: (count: number) => void;
}

export function usePluginsMarketplace(): UsePluginsMarketplaceResult {
  const service = usePluginsMarketplaceStore((s) => s.service);
  const cacheStatus = usePluginsMarketplaceStore((s) => s.cacheStatus);
  const updateCount = usePluginsMarketplaceStore((s) => s.updateCount);
  const setCacheStatus = usePluginsMarketplaceStore((s) => s.setCacheStatus);
  const setUpdateCount = usePluginsMarketplaceStore((s) => s.setUpdateCount);

  return { service, cacheStatus, updateCount, setCacheStatus, setUpdateCount };
}

/**
 * Thin selector for components (e.g. SettingsModal nav) that only need the
 * update count and would otherwise re-render whenever any other field on the
 * marketplace store changed. Returns 0 when no marketplace service is active.
 */
export function usePluginUpdateCount(): number {
  return usePluginsMarketplaceStore((s) => s.updateCount);
}
