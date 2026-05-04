/**
 * MarketplaceTab — container for Settings → Marketplace.
 *
 * Hosts a two-tab strip: `Templates` and `Plugins`. Both are active as of
 * Stream C4. The active subtab's MarketplaceService drives the offline
 * banner so users see cache state for the catalog they are looking at.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTemplatesMarketplace } from '@/hooks/useTemplatesMarketplace';
import { usePluginsMarketplace } from '@/hooks/usePluginsMarketplace';
import { MarketplaceOfflineBanner } from './MarketplaceOfflineBanner';
import { TemplatesTab } from './TemplatesTab';
import { PluginsTab } from './PluginsTab';

type MarketplaceSubtab = 'templates' | 'plugins';

export function MarketplaceTab() {
  const [subtab, setSubtab] = useState<MarketplaceSubtab>('templates');
  const templates = useTemplatesMarketplace();
  const plugins = usePluginsMarketplace();

  // Banner reflects the active subtab's cache state. We pull both hooks so
  // we don't conditionally call hooks based on `subtab`.
  const activeService = subtab === 'plugins' ? plugins.service : templates.service;
  const activeCacheStatus =
    subtab === 'plugins' ? plugins.cacheStatus : templates.cacheStatus;
  const activeSetCacheStatus =
    subtab === 'plugins' ? plugins.setCacheStatus : templates.setCacheStatus;

  return (
    <div className="space-y-4" data-testid="marketplace-tab">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Marketplace</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Browse community templates and plugins. Installs are stored in your
          workspace and can be removed at any time.
        </p>
      </div>

      <Tabs
        value={subtab}
        onValueChange={(v) => {
          setSubtab(v as MarketplaceSubtab);
        }}
        className="space-y-4"
      >
        <TabsList data-testid="marketplace-subtab-list">
          <TabsTrigger value="templates" data-testid="marketplace-subtab-templates">
            Templates
          </TabsTrigger>
          <TabsTrigger value="plugins" data-testid="marketplace-subtab-plugins">
            Plugins
          </TabsTrigger>
        </TabsList>

        <MarketplaceOfflineBanner
          service={activeService}
          cacheStatus={activeCacheStatus}
          onRefreshed={activeSetCacheStatus}
        />

        <TabsContent value="templates" data-testid="marketplace-subtab-content-templates">
          <TemplatesTab />
        </TabsContent>

        <TabsContent value="plugins" data-testid="marketplace-subtab-content-plugins">
          <PluginsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

