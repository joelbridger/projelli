/**
 * MarketplaceTab — container for Settings → Marketplace.
 *
 * Hosts a two-tab strip: `Templates` (active in C1) and `Plugins` (disabled
 * with a "Coming soon" tooltip; lands in Stream C3). The component is a
 * SHELL only: the templates catalog grid and detail view land in Group VI's
 * `TemplatesTab.tsx` and replace the placeholder rendered here.
 *
 * The tab also surfaces the offline / stale catalog banner above whatever
 * the active subtab renders, so users see the cache state regardless of
 * which subtab they are on.
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTemplatesMarketplace } from '@/hooks/useTemplatesMarketplace';
import { MarketplaceOfflineBanner } from './MarketplaceOfflineBanner';
import { TemplatesTab } from './TemplatesTab';

type MarketplaceSubtab = 'templates' | 'plugins';

export function MarketplaceTab() {
  const [subtab, setSubtab] = useState<MarketplaceSubtab>('templates');
  const { service, cacheStatus, setCacheStatus } = useTemplatesMarketplace();

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
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Wrap the disabled trigger in a span so the tooltip still
                    fires hover on a button that has pointer-events:none. */}
                <span className="inline-flex">
                  <TabsTrigger
                    value="plugins"
                    disabled
                    data-testid="marketplace-subtab-plugins"
                    aria-disabled="true"
                  >
                    Plugins
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent data-testid="marketplace-subtab-plugins-tooltip">
                Coming soon
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </TabsList>

        <MarketplaceOfflineBanner
          service={service}
          cacheStatus={cacheStatus}
          onRefreshed={setCacheStatus}
        />

        <TabsContent value="templates" data-testid="marketplace-subtab-content-templates">
          <TemplatesTab />
        </TabsContent>

        <TabsContent value="plugins" data-testid="marketplace-subtab-content-plugins">
          {/* Disabled subtab. Content here is only reachable via direct value
              control during tests; production users cannot toggle to it. */}
          <p className="text-sm text-muted-foreground py-8 text-center">
            Plugins marketplace is coming soon.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

