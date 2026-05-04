/**
 * Plugins Marketplace store
 *
 * Holds the per-workspace plugins `MarketplaceService` instance so React
 * components under Settings → Marketplace → Plugins can read it without
 * prop-drilling through the entire SettingsModal tree.
 *
 * Mirrors `templatesMarketplaceStore` so the C4 hook surface stays uniform
 * with the C1 templates hook surface.
 *
 * App.tsx seeds the store via `seed(...)` whenever the workspace changes;
 * on workspace teardown it calls `clear()`. The hook
 * `usePluginsMarketplace` (see `@/hooks/usePluginsMarketplace`) is the
 * canonical reader.
 *
 * `cacheStatus` and `updateCount` are mirrored on the store rather than
 * computed on every render so multiple Marketplace components share one
 * subscription. Updaters (`setCacheStatus`, `setUpdateCount`) are called
 * from the components that drive refresh + checkForUpdates flows in later
 * groups.
 */

import { create } from 'zustand';
import type { MarketplaceService, CacheStatus } from '@/modules/marketplace';

export interface PluginsMarketplaceState {
  service: MarketplaceService | null;
  cacheStatus: CacheStatus;
  /** Count of plugins with available updates. Surfaced in nav badges. */
  updateCount: number;

  seed: (service: MarketplaceService | null) => void;
  clear: () => void;
  setCacheStatus: (status: CacheStatus) => void;
  setUpdateCount: (count: number) => void;
}

export const usePluginsMarketplaceStore = create<PluginsMarketplaceState>()(
  (set) => ({
    service: null,
    cacheStatus: 'offline',
    updateCount: 0,

    seed: (service) => {
      set({
        service,
        cacheStatus: service?.cacheStatus() ?? 'offline',
      });
    },

    clear: () => {
      set({
        service: null,
        cacheStatus: 'offline',
        updateCount: 0,
      });
    },

    setCacheStatus: (status) => {
      set({ cacheStatus: status });
    },
    setUpdateCount: (count) => {
      set({ updateCount: count });
    },
  }),
);
