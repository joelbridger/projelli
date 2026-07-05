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

import { useScopeUpdateEntries } from '@/platform/rag/scopeUpdateStore';

export function ScopeUpdateBanner() {
  const entries = useScopeUpdateEntries();
  if (entries.length === 0) return null;

  const anyFailed = entries.some((e) => e.status === 'failed');
  const message = anyFailed
    ? 'Search scope update failed - retrying. Some content is held out of search until it applies.'
    : 'Updating search scope. New privacy and client rules apply once this finishes.';

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
        {message}
      </span>
    </div>
  );
}

export default ScopeUpdateBanner;
