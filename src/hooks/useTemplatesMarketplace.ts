/**
 * useTemplatesMarketplace — React hook over the templates marketplace store.
 *
 * Returns the workspace-bound `MarketplaceService` + `TemplateMetadataReader`
 * plus the latest `cacheStatus` and `updateCount`. Consumers under
 * `src/components/marketplace/` use this rather than reading App refs.
 *
 * The store is seeded by App.tsx on workspace select. Until a workspace is
 * loaded, `service` and `reader` are both `null` and components should
 * render an empty / "select a workspace" state.
 */

import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';
import type { MarketplaceService, CacheStatus } from '@/modules/marketplace';
import type { TemplateMetadataReader } from '@/modules/marketplace';

export interface UseTemplatesMarketplaceResult {
  service: MarketplaceService | null;
  reader: TemplateMetadataReader | null;
  cacheStatus: CacheStatus;
  updateCount: number;
  setCacheStatus: (status: CacheStatus) => void;
  setUpdateCount: (count: number) => void;
}

export function useTemplatesMarketplace(): UseTemplatesMarketplaceResult {
  const service = useTemplatesMarketplaceStore((s) => s.service);
  const reader = useTemplatesMarketplaceStore((s) => s.reader);
  const cacheStatus = useTemplatesMarketplaceStore((s) => s.cacheStatus);
  const updateCount = useTemplatesMarketplaceStore((s) => s.updateCount);
  const setCacheStatus = useTemplatesMarketplaceStore((s) => s.setCacheStatus);
  const setUpdateCount = useTemplatesMarketplaceStore((s) => s.setUpdateCount);

  return { service, reader, cacheStatus, updateCount, setCacheStatus, setUpdateCount };
}
