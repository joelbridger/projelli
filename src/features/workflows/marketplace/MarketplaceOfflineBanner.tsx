/**
 * MarketplaceOfflineBanner — inline banner shown above the catalog when the
 * `MarketplaceService` reports a non-fresh `cacheStatus`.
 *
 * Layout (per Stream C1 plan §5.2):
 *   "Showing cached catalog. Last updated <relative time>. [Retry]"
 *
 * Status-specific copy:
 *   - 'stale'   amber, "Showing cached catalog..." + Retry
 *   - 'offline' destructive tint, "Marketplace unreachable..." + Retry
 *   - 'fresh'   renders nothing
 *
 * The Retry button calls `service.refresh()` and then surfaces the new
 * `cacheStatus()` back to the parent via `onRefreshed` so the banner can
 * disappear (or update its tint) without a re-mount.
 */

import { useCallback, useState } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';
import type {
  CacheStatus,
  MarketplaceService,
} from '@/features/workflows/marketplace/svc';
import { RefreshCw, AlertCircle, WifiOff } from 'lucide-react';

interface MarketplaceOfflineBannerProps {
  service: MarketplaceService | null;
  cacheStatus: CacheStatus;
  /** Called after a successful or failed refresh so the parent can re-read cacheStatus. */
  onRefreshed?: (next: CacheStatus) => void;
}

export function MarketplaceOfflineBanner({
  service,
  cacheStatus,
  onRefreshed,
}: MarketplaceOfflineBannerProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(async () => {
    if (!service) return;
    setRetrying(true);
    try {
      await service.refresh();
    } catch {
      // Errors are reflected in the next cacheStatus() read; no rethrow.
    } finally {
      setRetrying(false);
      onRefreshed?.(service.cacheStatus());
    }
  }, [service, onRefreshed]);

  if (cacheStatus === 'fresh') return null;

  const lastFetchedAt = service?.lastFetchedAtIso() ?? null;
  const isOffline = cacheStatus === 'offline';

  const Icon = isOffline ? WifiOff : AlertCircle;
  const headline = isOffline
    ? 'Marketplace unreachable.'
    : 'Showing cached catalog.';
  const detail =
    lastFetchedAt !== null
      ? `Last updated ${formatRelativeTime(lastFetchedAt)}.`
      : 'No cached catalog yet.';

  return (
    <div
      data-testid="marketplace-offline-banner"
      data-status={cacheStatus}
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 text-sm',
        isOffline
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <span className="font-medium">{headline}</span>{' '}
        <span className="opacity-90">{detail}</span>
      </div>
      <Button
        data-testid="marketplace-offline-retry"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 text-xs"
        onClick={() => {
          void handleRetry();
        }}
        disabled={retrying || !service}
      >
        <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} aria-hidden="true" />
        {retrying ? 'Retrying...' : 'Retry'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal: small relative-time formatter. Avoids pulling in date-fns just
// for one banner; the Marketplace UI doesn't render this format anywhere
// else.
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatUnit(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatUnit(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 30) return formatUnit(days, 'day');
  const months = Math.floor(days / 30);
  if (months < 12) return formatUnit(months, 'month');
  const years = Math.floor(months / 12);
  return formatUnit(years, 'year');
}

function formatUnit(n: number, unit: string): string {
  const label = n === 1 ? unit : `${unit}s`;
  return `${n.toString()} ${label} ago`;
}
