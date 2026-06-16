/**
 * PluginCatalogCard — single tile inside the Plugins catalog grid.
 *
 * Mirrors `TemplateCatalogCard` shape (screenshot, name, description,
 * version, author, CTA) but adds a small "N permissions" badge so the
 * required-permission count is legible at the catalog level. The exact
 * permission list lives in the consent dialog one click later.
 */

import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Puzzle, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CatalogEntry } from '@/types/marketplace';

interface PluginCatalogCardProps {
  entry: CatalogEntry;
  /**
   * Number of permissions the plugin requests, sourced from its manifest.
   * Optional because the catalog response doesn't include permission lists;
   * the count is only known once the plugin's manifest has been fetched
   * (lazy or via a sidecar count column on the catalog itself in v2.x).
   */
  permissionCount?: number | undefined;
  /** True if this plugin is already installed at the same version. */
  installed?: boolean;
  /** True if this plugin has an update available. */
  updateAvailable?: boolean;
  /** Open the detail view for this plugin. The inline CTA also calls this. */
  onSelect: (id: string) => void;
}

export function PluginCatalogCard({
  entry,
  permissionCount,
  installed = false,
  updateAvailable = false,
  onSelect,
}: PluginCatalogCardProps) {
  const screenshot = entry.screenshots?.[0];
  const [imgFailed, setImgFailed] = useState(false);

  const handleSelect = useCallback(() => {
    onSelect(entry.id);
  }, [entry.id, onSelect]);

  const handleInstallClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Stop propagation so the parent card click doesn't fire twice.
      e.stopPropagation();
      onSelect(entry.id);
    },
    [entry.id, onSelect],
  );

  const ctaLabel = installed
    ? updateAvailable
      ? 'Update'
      : 'Installed'
    : 'Install';

  return (
    <Card
      data-testid={`plugin-catalog-card-${entry.id}`}
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect();
        }
      }}
      className={cn(
        'group flex flex-col overflow-hidden cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div
        data-testid={`plugin-catalog-card-${entry.id}-screenshot`}
        className="aspect-video w-full bg-muted flex items-center justify-center overflow-hidden"
      >
        {screenshot && !imgFailed ? (
          <img
            src={screenshot}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => { setImgFailed(true); }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-sm border border-border/40 bg-muted">
            <Puzzle className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            data-testid={`plugin-catalog-card-${entry.id}-name`}
            className="font-medium text-sm leading-tight line-clamp-2"
          >
            {entry.name}
          </h3>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            v{entry.version}
          </span>
        </div>

        <p
          data-testid={`plugin-catalog-card-${entry.id}-description`}
          className="text-xs text-muted-foreground line-clamp-2 flex-1"
        >
          {entry.description}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground truncate">
              by {entry.author.name}
            </span>
            {typeof permissionCount === 'number' ? (
              <span
                data-testid={`plugin-catalog-card-${entry.id}-permission-count`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0"
                title={`Requests ${permissionCount.toString()} permission${permissionCount === 1 ? '' : 's'}`}
              >
                <ShieldAlert className="h-2.5 w-2.5" aria-hidden="true" />
                {permissionCount} {permissionCount === 1 ? 'permission' : 'permissions'}
              </span>
            ) : null}
          </div>
          <Button
            data-testid={`plugin-catalog-card-${entry.id}-cta`}
            size="sm"
            variant={installed && !updateAvailable ? 'secondary' : 'default'}
            className="h-7 px-2 text-xs gap-1"
            onClick={handleInstallClick}
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            {ctaLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
