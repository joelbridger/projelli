/**
 * ScopeUpdateBanner (QA-44) — slim banner that tells the advisor when a search
 * scope change (marking a source privileged, or moving a folder / mailbox to a
 * different client) has NOT yet taken effect in search.
 *
 * Before this, those re-tags were fire-and-forget: a failure was swallowed and
 * the UI silently implied the new rule was live. Now a pending or failed re-tag
 * is visible here, so nobody trusts a privacy/scoping rule that hasn't actually
 * applied yet. While it shows, retrieval is fail-closed for the affected content
 * (see `MemoryService.retrieve` + `scopeUpdateStore`).
 *
 * Visibility:
 *   - any entry 'failed'  → warning tone, "search scope update failed - retrying"
 *   - else (all retrying) → muted tone, "updating search scope..."
 *   - no entries          → renders nothing
 *
 * Light-theme friendly (amber warning on a light wash), matching the house
 * light-first UI. No em dashes (house copy rule).
 */

import { useEffect, useState } from 'react';
import { useScopeUpdateEntries } from '@/platform/rag/scopeUpdateStore';
import { ragScopeWriteQueueDepth } from '@/platform/utils/tauri-commands';

function PendingScopeUpdateMessage() {
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refresh = (): void => {
      ragScopeWriteQueueDepth()
        .then((depth) => {
          if (!disposed) setQueued(depth > 0);
        })
        .catch(() => {
          // Status lookup is only a hint. The operation has its own honest
          // retry/failure path, so a polling hiccup falls back to "updating".
          if (!disposed) setQueued(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 250);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return queued
    ? 'Queued behind another search update. This will start as soon as the current update finishes.'
    : 'Updating search scope. New privacy and client rules apply once this finishes.';
}

export function ScopeUpdateBanner() {
  const entries = useScopeUpdateEntries();

  if (entries.length === 0) return null;

  const anyFailed = entries.some((e) => e.status === 'failed');

  return (
    <div
      data-testid="scope-update-banner"
      role="status"
      aria-live="polite"
      className={
        'flex items-center gap-3 px-4 py-2 border-b text-xs ' +
        (anyFailed
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-muted/40 text-foreground')
      }
    >
      {!anyFailed && (
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      <span className="min-w-0 truncate font-medium" data-testid="scope-update-message">
        {anyFailed ? (
          'Search scope update failed - retrying. Some content is held out of search until it applies.'
        ) : (
          <PendingScopeUpdateMessage />
        )}
      </span>
    </div>
  );
}

export default ScopeUpdateBanner;
