/**
 * PluginDetailView — STUB. Final implementation lands in Group IV of the
 * Stream C4 plan (state-aware Install / Update / Disable / Uninstall flow,
 * permission consent integration, install progress phases).
 *
 * This stub renders just enough to satisfy navigation: a Back button,
 * the catalog entry's name, and a "coming in Group IV" placeholder. The
 * Group III tests cover the navigation contract; the rich behavior is
 * tested by Group IV's test suite.
 */

import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';
import type { MarketplaceService } from '@/modules/marketplace';

interface PluginDetailViewProps {
  entry: CatalogEntry;
  service: MarketplaceService;
  installed?: InstalledEntry | undefined;
  updateAvailable?: boolean;
  onBack: () => void;
  onInstalled?: (e: InstalledEntry) => void;
  onUninstalled?: (id: string) => void;
}

export function PluginDetailView({
  entry,
  service: _service,
  installed: _installed,
  updateAvailable: _updateAvailable,
  onBack,
  onInstalled: _onInstalled,
  onUninstalled: _onUninstalled,
}: PluginDetailViewProps) {
  return (
    <div className="space-y-4" data-testid="plugin-detail-view">
      <div className="flex items-center gap-2">
        <Button
          data-testid="plugin-detail-back"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
      </div>
      <div>
        <h2
          data-testid="plugin-detail-name"
          className="text-2xl font-semibold tracking-tight"
        >
          {entry.name}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          v{entry.version} by {entry.author.name}
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Detail view coming in Group IV.
      </div>
    </div>
  );
}
