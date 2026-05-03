/**
 * Templates Marketplace store
 *
 * Holds the per-workspace `MarketplaceService` + `TemplateMetadataReader`
 * instances so React components under Settings → Marketplace can read them
 * without prop-drilling through the entire SettingsModal tree.
 *
 * App.tsx seeds the store via `setMarketplace(...)` whenever the workspace
 * changes; on workspace teardown it calls `clearMarketplace()`. The hook
 * `useTemplatesMarketplace` (see `@/hooks/useTemplatesMarketplace`) is the
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
import type { TemplateMetadataReader } from '@/modules/marketplace';

export interface TemplatesMarketplaceState {
  service: MarketplaceService | null;
  reader: TemplateMetadataReader | null;
  cacheStatus: CacheStatus;
  /** Count of templates with available updates. Surfaced in nav badges. */
  updateCount: number;

  setMarketplace: (
    service: MarketplaceService | null,
    reader: TemplateMetadataReader | null,
  ) => void;
  clearMarketplace: () => void;
  setCacheStatus: (status: CacheStatus) => void;
  setUpdateCount: (count: number) => void;
}

export const useTemplatesMarketplaceStore = create<TemplatesMarketplaceState>()(
  (set) => ({
    service: null,
    reader: null,
    cacheStatus: 'offline',
    updateCount: 0,

    setMarketplace: (service, reader) => {
      set({
        service,
        reader,
        cacheStatus: service?.cacheStatus() ?? 'offline',
      });
    },

    clearMarketplace: () => {
      set({
        service: null,
        reader: null,
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
