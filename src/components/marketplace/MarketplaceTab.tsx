/**
 * MarketplaceTab — container for Settings → Marketplace.
 *
 * Shows the Templates catalog. The Plugins subtab has been removed as part of
 * the 3.0 product repositioning (law-practice focus).
 */

import { useTemplatesMarketplace } from '@/hooks/useTemplatesMarketplace';
import { MarketplaceOfflineBanner } from './MarketplaceOfflineBanner';
import { TemplatesTab } from './TemplatesTab';

export function MarketplaceTab() {
  const templates = useTemplatesMarketplace();

  return (
    <div className="space-y-4" data-testid="marketplace-tab">
      <MarketplaceOfflineBanner
        service={templates.service}
        cacheStatus={templates.cacheStatus}
        onRefreshed={templates.setCacheStatus}
      />
      <div data-testid="marketplace-subtab-content-templates">
        <TemplatesTab />
      </div>
    </div>
  );
}
