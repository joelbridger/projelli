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
 *   - work in progress → named task, completed/total count, and progress bar
 *   - any entry failed → warning that only search is paused; clients stay usable
 *   - all work done → short-lived ready message, then the banner clears
 *   - no work or completion → renders nothing
 *
 * Light-theme friendly (amber warning on a light wash), matching the house
 * light-first UI. No em dashes (house copy rule).
 */

import { useEffect, useState } from 'react';
import {
  useScopeUpdateCompletion,
  useScopeUpdateEntries,
  useScopeUpdateProgress,
  useScopeUpdateStore,
  type ScopeUpdateKind,
} from '@/platform/rag/scopeUpdateStore';
import { ragScopeWriteQueueDepth } from '@/platform/utils/tauri-commands';
import { BRAND } from '@/config/brand';

function PendingScopeUpdateMessage({
  completed,
  total,
  kinds,
}: {
  completed: number;
  total: number;
  kinds: ScopeUpdateKind[];
}) {
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

  const uniqueKinds = new Set(kinds);
  const name = uniqueKinds.size === 1 && uniqueKinds.has('matter')
    ? 'Getting your client files ready for search'
    : uniqueKinds.size === 1 && uniqueKinds.has('mail')
      ? 'Getting client email ready for search'
      : uniqueKinds.size === 1 && uniqueKinds.has('privilege')
        ? 'Applying your updated search privacy rules'
        : 'Getting client search ready';
  const unit = uniqueKinds.size === 1 && uniqueKinds.has('matter')
    ? 'folders'
    : uniqueKinds.size === 1 && uniqueKinds.has('mail')
      ? 'mailboxes'
      : uniqueKinds.size === 1 && uniqueKinds.has('privilege')
        ? 'privacy rules'
        : 'updates';
  const left = Math.max(0, total - completed);

  return (
    <>
      {name}. {completed} of {total} {unit} ready, {left} left.
      {queued ? ' Queued behind another search update.' : ''}
    </>
  );
}

export function ScopeUpdateBanner() {
  const entries = useScopeUpdateEntries();
  const progress = useScopeUpdateProgress();
  const completion = useScopeUpdateCompletion();

  useEffect(() => {
    if (!completion) return;
    const timer = window.setTimeout(() => {
      useScopeUpdateStore.getState().dismissCompletion();
    }, 4000);
    return () => { window.clearTimeout(timer); };
  }, [completion]);

  if (entries.length === 0 && completion) {
    const clientsReady = completion.kinds.length > 0 && completion.kinds.every(
      (kind) => kind === 'matter',
    );
    return (
      <div
        data-testid="scope-update-banner"
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground"
      >
        <span data-testid="scope-update-complete">
          {clientsReady ? 'Your client files are ready for search.' : 'Client search is ready.'}
        </span>
        <button
          type="button"
          className="ml-auto text-xs underline"
          onClick={() => { useScopeUpdateStore.getState().dismissCompletion(); }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (entries.length === 0) return null;

  const anyFailed = entries.some((e) => e.status === 'failed');
  const total = progress?.total ?? entries.length;
  const completed = progress?.completed ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const kinds = progress?.kinds ?? entries.map((entry) => entry.kind);

  return (
    <div
      data-testid="scope-update-banner"
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 px-4 py-2 border-b bg-muted/40 text-foreground text-xs"
      style={anyFailed ? {
        background: 'var(--kp-warning-bg)',
        color: 'var(--kp-warning)',
        borderColor: 'var(--kp-warning-line)',
      } : undefined}
    >
      <span className="min-w-0 flex-1 font-medium" data-testid="scope-update-message">
        {anyFailed ? (
          `Client search update needs attention. You can still open and read every client. Some search results are paused until ${BRAND.name} retries this update.`
        ) : (
          <PendingScopeUpdateMessage completed={completed} total={total} kinds={kinds} />
        )}
      </span>
      {!anyFailed && (
        <div
          data-testid="scope-update-progress"
          role="progressbar"
          aria-label="Client search preparation"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
          className="w-32 h-1.5 bg-background rounded-full overflow-hidden border"
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${String(pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default ScopeUpdateBanner;
