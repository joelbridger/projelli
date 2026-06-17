/**
 * TemplateCatalogCard — single tile inside the Templates catalog grid.
 *
 * Renders the first screenshot (or a placeholder), name, one-line
 * description, version, and author for a `CatalogEntry`. Clicking anywhere
 * on the card OR the inline [Install] button invokes `onSelect(id)`. The
 * detail view is responsible for the actual install confirmation — the
 * inline CTA is a shortcut into that flow per spec, not a one-click install.
 */

import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CatalogEntry } from '@/features/workflows/types/marketplace';

interface TemplateCatalogCardProps {
  entry: CatalogEntry;
  /** True if this template is already installed at the same version. */
  installed?: boolean;
  /** True if this template has an update available. Reserved for Group VIII. */
  updateAvailable?: boolean;
  /** Open the detail view for this template. The inline CTA also calls this. */
  onSelect: (id: string) => void;
}

export function TemplateCatalogCard({
  entry,
  installed = false,
  updateAvailable = false,
  onSelect,
}: TemplateCatalogCardProps) {
  const screenshot = entry.screenshots?.[0];
  const [imgFailed, setImgFailed] = useState(false);

  const handleSelect = useCallback(() => {
    onSelect(entry.id);
  }, [entry.id, onSelect]);

  const handleInstallClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Stop propagation so the parent card click doesn't fire twice; both
      // routes lead to the detail view but two onSelect calls churn state.
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
      data-testid={`template-catalog-card-${entry.id}`}
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
        data-testid={`template-catalog-card-${entry.id}-screenshot`}
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
            <FileText className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            data-testid={`template-catalog-card-${entry.id}-name`}
            className="font-medium text-sm leading-tight line-clamp-2"
          >
            {entry.name}
          </h3>
          <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
            v{entry.version}
          </span>
        </div>

        <p
          data-testid={`template-catalog-card-${entry.id}-description`}
          className="text-xs text-muted-foreground line-clamp-2 flex-1"
        >
          {entry.description}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted-foreground truncate">
            by {entry.author.name}
          </span>
          <Button
            data-testid={`template-catalog-card-${entry.id}-cta`}
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
