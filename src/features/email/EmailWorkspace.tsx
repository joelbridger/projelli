/**
 * EmailWorkspace — full-page email search and browse surface.
 *
 * Two modes:
 *   Search  — debounced mailListMessages() with provider / date / attachment
 *             filters; paginated "Load more" (offset += 50).
 *   Ask AI  — MemoryService.retrieve() scoped to mail: sourceIds; results
 *             ranked by similarity score.
 *
 * Per-row actions: Open (dispatches lantern:open-email), File to matter
 * (popover with matter picker — calls mailRetagMessageMatter per message),
 * Privilege (dropdown), Export (mailGetMessage + onSaveToWorkspace).
 *
 * Privilege is handled by a sub-component (MailRowPrivilege) so the hook
 * can be called per-row without violating the Rules of Hooks.
 *
 * Filter row is hidden by default; a "Filters" toggle shows a badge when
 * any filter is active.
 *
 * In keyword/Search mode the scope toggle is disabled — keyword search covers
 * all email. Scope toggle only works in Ask AI mode.
 *
 * Bulk row selection: checkbox (appears on hover or when any row is selected);
 * a bulk action bar appears when any rows are selected.
 *
 * Light theme only. CSS variables + inline styles. No dark mode.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Mail,
  Search,
  Loader2,
  AlertTriangle,
  PenLine,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { Button, SearchField, SegmentedToggle, FilterToggle, FilterPanel, SurfaceToolbar, Callout } from '@/ui/kp';
import { useActiveMatter, useMatters } from '@/platform/matter/matterStore';
import { resolveMailMatter } from '@/platform/rag/matterResolver';
import { useMailStore } from './mailStore';
import {
  mailListMessages,
  type MailListItem,
} from '@/platform/utils/mail-commands';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { mapMailError, filterInputStyle } from './emailWorkspaceHelpers';
import { AskHitCard } from './AskHitCard';
import { NoAccountsState } from './NoAccountsState';
import { MailRow } from './MailRow';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { useScrollPersistence } from './useScrollPersistence';
import { ComposeModal } from './ComposeModal';
import { BulkActionBar } from './BulkActionBar';
import { useAccountSync } from './useAccountSync';
import { EV_OPEN_SETTINGS } from '@/config/identity';

// ── Perf (P2.2) ──────────────────────────────────────────────────────────────
// The results list only virtualizes past this many rows — below it, the
// difference is imperceptible and rendering directly keeps behavior/tests
// (which use small fixture lists) exactly as before. Above it (a busy inbox
// approaching the 200-row page cap), each MailRow is a fairly heavy DOM
// subtree (checkbox, badges, hover actions), so an un-virtualized list gets
// noticeably heavier to paint and scroll.
const EMAIL_VIRTUALIZE_ROW_THRESHOLD = 40;
// A reasonable average MailRow height — rows vary (snippet/attachments/badges
// change height slightly), so this is only the INITIAL estimate; the
// virtualizer measures each row's real height once rendered and corrects for
// it, same pattern as SheetGrid.
const MAIL_ROW_ESTIMATED_HEIGHT_PX = 88;

// ── Props ──────────────────────────────────────────────────────────────────

export interface EmailWorkspaceProps {
  onSaveToWorkspace?: ((content: string, suggestedName: string) => Promise<void>) | undefined;
  onOpenSettings?: (() => void) | undefined;
  /**
   * Embedded mode — the per-client Email sub-tab inside the Client Map hub.
   * Hides the standalone "Email" surface header and the "This client / All
   * email" scope toggle, and scopes BOTH the keyword browse list and the AI
   * search to the active client's correspondence (per-client only; the global
   * inbox as a destination is gone — global reach is Ctrl+P + Ask citations).
   */
  embedded?: boolean;
}

// ── No-accounts empty state ────────────────────────────────────────────────

// ── Main export ────────────────────────────────────────────────────────────

export function EmailWorkspace({
  onSaveToWorkspace,
  onOpenSettings,
  embedded = false,
}: EmailWorkspaceProps) {
  const activeMatter = useActiveMatter();

  // Per-client (embedded) browse fetches a deeper page so a client's mail is far
  // more likely to surface in one shot; combined with the reachable "Load more"
  // in the empty state below, this avoids a dead-end when the client's mail
  // isn't among the newest rows. (A fully accurate server-side per-matter list
  // is a backend follow-up — `mail_list_messages` has no matter filter.)
  const PAGE_SIZE = embedded ? 200 : 50;

  // First-connect TTV callout — shown once after the first account is connected.
  const { firstConnectCalloutSeen, dismissFirstConnectCallout } = useMailStore();

  // Scope toggle: "This matter" vs "All email" — only effective in Ask AI mode
  const [scopeAllEmail, setScopeAllEmail] = useState(false);

  // Mode toggle: "keyword" (shows as "Search") vs "ask" (shows as "Ask AI")
  const [mode, setMode] = useState<'keyword' | 'ask'>('keyword');

  // Filter row visibility (collapsed by default)
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Search / filter state
  const [query, setQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [hasAttachments, setHasAttachments] = useState(false);

  // Keyword results
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Incrementing this forces Effect A to re-run the query (retry on error)
  const [retryCount, setRetryCount] = useState(0);

  // Ask mode results
  const [askHits, setAskHits] = useState<RagHit[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Account sync: load accounts, startup auto-sync, sync-done listener, handleSyncNow
  const { syncing, syncStalled, syncError, accounts, accountsLoaded, hasConnectedMail, handleSyncNow } = useAccountSync({
    onNoAccounts: useCallback(() => {
      setItems([]);
      setTotal(0);
      setOffset(0);
      setError(null);
      setAskHits([]);
      setAskLoading(false);
      setAskError(null);
    }, []),
    onSyncDone: useCallback(() => { setRetryCount((c) => c + 1); }, []),
  });

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMatterOpen, setBulkMatterOpen] = useState(false);

  // Compose open state — compose state/effects live in ComposeModal
  const [composeOpen, setComposeOpen] = useState(false);

  // Ref for focusing the search field from the first-connect callout CTA.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Debounce ref and request fingerprint tracking
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef(0);
  // Fingerprint tracks query/filter params (not offset) to detect filter changes in Effect B
  const queryFingerprintRef = useRef('');

  // Effect A: fires on query/filter param changes (debounced 200ms, resets offset to 0)
  useEffect(() => {
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;
    if (accounts.length === 0) {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      setItems([]);
      setTotal(0);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      return;
    }

    // Update fingerprint for current filter params
    const fingerprint = JSON.stringify({ query, providerFilter, dateFrom, dateTo, hasAttachments, mode });
    queryFingerprintRef.current = fingerprint;

    const thisQuery = ++latestQueryRef.current;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => { void (async () => {
      // WS6 diagnostics — structural count only, no query text captured.
      void sendDiagnosticEvent({ event: 'feature_used', feature: 'search' }).catch(() => undefined);
      void sendDiagnosticEvent({ event: 'search_count', count: 1 }).catch(() => undefined);
      // Reset to first page when filters change
      setOffset(0);
      setLoading(true);
      setError(null);

      try {
        const listQuery: Parameters<typeof mailListMessages>[0] = {
          sortBy: 'date',
          sortDesc: true,
          limit: PAGE_SIZE,
          offset: 0,
        };
        if (query) listQuery.keyword = query;
        if (providerFilter) listQuery.provider = providerFilter;
        if (dateFrom) listQuery.dateFrom = dateFrom;
        // Ensure dateTo is end-of-day inclusive when it's a date-only string
        if (dateTo) {
          listQuery.dateTo = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
        }
        if (hasAttachments) listQuery.hasAttachments = true;

        const result = await mailListMessages(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems(result.items);
        setTotal(result.total);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(mapMailError(e));
      } finally {
        if (latestQueryRef.current === thisQuery) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })(); }, 200);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [mode, accountsLoaded, accounts.length, query, providerFilter, dateFrom, dateTo, hasAttachments, retryCount, PAGE_SIZE]);

  // Effect B: fires immediately when offset > 0 (load-more), but only if the
  // fingerprint hasn't changed (i.e., purely a pagination action, not a filter change).
  useEffect(() => {
    if (offset === 0) return; // first page is handled by Effect A
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;
    if (accounts.length === 0) return;

    // Check that fingerprint matches current filter state — if not, Effect A handles it
    const currentFingerprint = JSON.stringify({ query, providerFilter, dateFrom, dateTo, hasAttachments, mode });
    if (currentFingerprint !== queryFingerprintRef.current) return;

    const thisQuery = ++latestQueryRef.current;
    setLoadingMore(true);
    setError(null);

    void (async () => {
      try {
        const listQuery: Parameters<typeof mailListMessages>[0] = {
          sortBy: 'date',
          sortDesc: true,
          limit: PAGE_SIZE,
          offset,
        };
        if (query) listQuery.keyword = query;
        if (providerFilter) listQuery.provider = providerFilter;
        if (dateFrom) listQuery.dateFrom = dateFrom;
        if (dateTo) {
          listQuery.dateTo = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`;
        }
        if (hasAttachments) listQuery.hasAttachments = true;

        const result = await mailListMessages(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems((prev) => [...prev, ...result.items]);
        setTotal(result.total);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(mapMailError(e));
      } finally {
        if (latestQueryRef.current === thisQuery) {
          setLoadingMore(false);
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  // Ask mode search
  useEffect(() => {
    if (mode !== 'ask') return;
    if (!hasConnectedMail) {
      setAskHits([]);
      setAskLoading(false);
      setAskError(null);
      return;
    }
    if (!query.trim()) {
      setAskHits([]);
      return;
    }
    if (!isMemoryEnabled()) {
      setAskError('Memory (RAG) is not enabled. Enable it in Settings to use AI search.');
      return;
    }

    let cancelled = false;
    const thisQuery = ++latestQueryRef.current;
    setAskLoading(true);
    setAskError(null);

    const scope: RetrievalScope = activeMatter && !scopeAllEmail
      ? { kind: 'matter', matterId: activeMatter.id }
      : { kind: 'allMatters' };

    MemoryService.retrieve(query, 10, scope, false)
      .then((hits) => {
        if (cancelled || latestQueryRef.current !== thisQuery) return;
        // Filter to mail: sourceIds only (sourceId is optional on RagHit)
        const mailHits = hits.filter((h) => {
          const sid = h.sourceId ?? h.path;
          return sid.startsWith('mail:');
        });
        // Deduplicate by sourceId, keep highest score
        const bySource = new Map<string, RagHit>();
        for (const h of mailHits) {
          const key = h.sourceId ?? h.path;
          const existing = bySource.get(key);
          if (!existing || h.score > existing.score) {
            bySource.set(key, h);
          }
        }
        const deduped = Array.from(bySource.values()).sort((a, b) => b.score - a.score);
        setAskHits(deduped);
      })
      .catch((e: unknown) => {
        if (cancelled || latestQueryRef.current !== thisQuery) return;
        setAskError(
          e instanceof Error ? e.message : 'Ask retrieval failed. Please try again.',
        );
      })
      .finally(() => {
        if (!cancelled && latestQueryRef.current === thisQuery) {
          setAskLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [mode, query, activeMatter, scopeAllEmail, hasConnectedMail]);

  // Reset offset + selection when filters change

  const handleProviderChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setProviderFilter(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleDateFromChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleDateToChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleAttachmentToggle = useCallback(() => {
    setHasAttachments((v) => !v);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleLoadMore = useCallback(() => {
    setOffset((o) => o + PAGE_SIZE);
  }, [PAGE_SIZE]);

  const handleRetry = useCallback(() => {
    setError(null);
    setOffset(0);
    setRetryCount((c) => c + 1);
  }, []);

  const handleClearQuery = useCallback(() => {
    setQuery('');
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const uniqueProviders = Array.from(new Set(accounts.map((a) => a.provider)));

  // Active filter count for badge
  const activeFilterCount = [providerFilter, dateFrom, dateTo, hasAttachments].filter(Boolean).length;

  // Per-client (embedded) browse scoping: filter the keyword list to mail whose
  // (provider, account, folder) maps to the active client's matter — the SAME
  // folder→matter resolution the indexer uses (`resolveMailMatter`). The global
  // browse list is untouched. Note: per-message filings (mail_retag_message_matter)
  // are an override the list path can't surface frontend-only, so this scopes by
  // folder mapping; a fully accurate server-side per-matter list is a backend
  // follow-up. AI search (Ask mode) is already matter-scoped via RetrievalScope.
  //
  // Perf (P2.2): memoized — unchanged logic/output, just not re-run (and not
  // re-scanning every item against every matter's folder mappings via
  // `resolveMailMatter`) on renders where none of `items`/`embedded`/
  // `activeMatter`/`matters` actually changed (e.g. hovering a row, opening
  // a row's popover, toggling the filters panel).
  //
  // Codex review (P2.2, round 1): this used to read `getMatters()` — a
  // non-reactive Zustand snapshot getter — INSIDE the filter body. The
  // pre-memo code got away with that because it re-read it on literally
  // every render for any reason; once memoized, a matters/folder-mapping
  // change (e.g. another client claiming a more specific folder) with none
  // of the other deps changing would never be picked up. `useMatters()` is
  // the reactive subscription to the same state, so it belongs in the
  // dependency array (and is what actually gets scanned below).
  const matters = useMatters();
  const scopedItems = useMemo(
    () =>
      embedded && activeMatter
        ? items.filter((m) => resolveMailMatter(matters, m.provider, m.account, m.folderId) === activeMatter.id)
        : items,
    [items, embedded, activeMatter, matters],
  );

  // Fix 7: persist list scroll position per-matter in sessionStorage.
  //
  // Perf (P2.2) — this now targets the results list's OWN scroll container
  // (a `flex: 1` region that fills whatever space is left below the
  // toolbar/filters/other states — see the render below), not the outer
  // page. Codex review (round 1) caught that pointing it at the page while
  // introducing a separate, dedicated inner scroll region for the actual
  // rows meant a user's scroll position within a long list was never
  // persisted — the page container rarely scrolls at all once the list
  // manages its own overflow, so the outer ref was the wrong (and now
  // largely inert) element to track.
  //
  // Codex review (round 2) then caught that the results box is itself
  // CONDITIONALLY rendered (hidden during loading/error/empty), so a plain
  // object ref + one-time effect (the hook's original design) frequently
  // ran before that box existed, restoring/saving against `null` forever.
  // `useScrollPersistence` now returns a callback ref (fires exactly when
  // the node mounts/unmounts) plus `getScrollElement()` for the
  // virtualizer, which needs to read the current node imperatively rather
  // than receive it as a ref object.
  const { scrollContainerRef, getScrollElement } = useScrollPersistence(activeMatter);

  // Perf (P2.2) — virtualize the results list past EMAIL_VIRTUALIZE_ROW_THRESHOLD
  // rows, using the SAME dedicated scroll container as scroll persistence
  // above — deliberately separate from the outer page's own scroll (used by
  // every other state: loading/error/no-results/filters/Ask mode). Keeping
  // virtualization scoped to its own dedicated, always-present scroll
  // element means it doesn't need to track the offset of anything above it
  // (filters panel, bulk-action bar) the way virtualizing a page-level
  // scroll region would.
  //
  // Codex review (round 3): this container was originally a fixed
  // max-height (560px) box rather than filling available space — that
  // shrank the safe zone for row popovers (File/Privilege, absolutely
  // positioned and clipped by any `overflow` ancestor) from the full page
  // height down to a few hundred pixels, so a dropdown opened on any row
  // past the first few got visibly clipped. The render below now makes the
  // results box `flex: 1` (fills remaining page height, same safe zone as
  // before virtualization existed) instead of a small fixed height.
  const shouldVirtualizeRows = scopedItems.length > EMAIL_VIRTUALIZE_ROW_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: scopedItems.length,
    getScrollElement,
    estimateSize: () => MAIL_ROW_ESTIMATED_HEIGHT_PX,
    overscan: 8,
    enabled: shouldVirtualizeRows,
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'var(--font-sans)',
        overflowY: 'auto',
      }}
    >
      {/* Page header — hidden when embedded as a per-client sub-tab (the hub
          already shows the client header above the sub-tab bar). */}
      {!embedded && (
        <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <SurfaceHeader
            Icon={Mail}
            title="Email"
            description="Search, read, and file your imported email."
          />
        </div>
      )}

      {/* Toolbar — compose, mode toggle, scope toggle (conditional), search, filters toggle */}
      {hasConnectedMail && (
      <SurfaceToolbar>
        {/* 1. Compose button */}
        <Button
          variant="primary"
          size="md"
          iconLeft={PenLine}
          data-testid="compose-btn"
          onClick={() => { setComposeOpen(true); }}
        >
          New email
        </Button>

        {/* 2. Mode toggle — standard bordered/navy-filled segmented control */}
        <div
          className="kp-segmented kp-segmented--md"
          role="group"
          aria-label="Search mode"
          style={{ flex: 'none' }}
        >
          {(['keyword', 'ask'] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`mode-${m}`}
              className={`kp-segmented__item${mode === m ? ' is-active' : ''}`}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                setQuery('');
                setOffset(0);
                setSelectedIds(new Set());
              }}
            >
              {m === 'keyword' ? 'Keyword' : 'AI search'}
            </button>
          ))}
        </div>

        {/* 3. Scope toggle — only when a matter is active AND in Ask AI mode.
            Hidden when embedded: the per-client Email sub-tab is locked to this
            client (no "All email" destination), so the toggle would be a no-op. */}
        {activeMatter && mode !== 'keyword' && !embedded && (
          <SegmentedToggle
            ariaLabel="Email scope"
            size="md"
            variant="filled"
            options={[
              { value: 'matter' as const, label: 'This client' },
              { value: 'all' as const, label: 'All email' },
            ]}
            value={scopeAllEmail ? 'all' : 'matter'}
            onChange={(v) => {
              setScopeAllEmail(v === 'all');
              setOffset(0);
            }}
          />
        )}

        {/* 4. Filters toggle — keyword mode only, when accounts are loaded */}
        {mode === 'keyword' && (
          <FilterToggle
            open={filtersVisible}
            onToggle={() => { setFiltersVisible((v) => !v); }}
            count={activeFilterCount}
            label="Filters"
            data-testid="filters-toggle"
          />
        )}

        {/* 4b. Sync now button — the toolbar only renders when mail is connected */}
        <Button
          variant="ghost"
          size="md"
          iconLeft={syncing ? Loader2 : RefreshCw}
          data-testid="email-sync-now"
          disabled={syncing}
          onClick={handleSyncNow}
          aria-label="Sync email now"
          style={syncing ? { opacity: 0.6 } : undefined}
        >
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          {syncing ? 'Syncing…' : 'Sync now'}
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        </Button>

        {/* 5. Search field — grows to fill remaining space, always last */}
        <SearchField
          ref={searchInputRef}
          size="md"
          icon={Search}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setOffset(0);
            setSelectedIds(new Set());
          }}
          onClear={handleClearQuery}
          placeholder={
            mode === 'keyword'
              ? 'Search email by keyword...'
              : 'Search your email with AI...'
          }
          aria-label="Search email"
          data-testid="email-search-input"
          style={{ flex: 1, minWidth: 240 }}
        />
      </SurfaceToolbar>
      )}

      {/* Filter panel — full-width below toolbar, keyword mode only */}
      {hasConnectedMail && mode === 'keyword' && filtersVisible && (
        <FilterPanel data-testid="filter-row">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            {/* Provider filter */}
            {uniqueProviders.length > 1 && (
              <select
                data-testid="provider-filter"
                value={providerFilter}
                onChange={handleProviderChange}
                aria-label="Filter by provider"
                style={filterInputStyle}
              >
                <option value="">All accounts</option>
                {uniqueProviders.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}

            {/* Date from */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
              From
              <input
                type="date"
                data-testid="date-from"
                value={dateFrom}
                onChange={handleDateFromChange}
                aria-label="From date"
                style={filterInputStyle}
              />
            </label>

            {/* Date to */}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
              To
              <input
                type="date"
                data-testid="date-to"
                value={dateTo}
                onChange={handleDateToChange}
                aria-label="To date"
                style={filterInputStyle}
              />
            </label>

            {/* Has attachment toggle */}
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                data-testid="attachment-filter"
                checked={hasAttachments}
                onChange={handleAttachmentToggle}
                style={{ accentColor: 'var(--kp-navy)', cursor: 'pointer' }}
              />
              Has attachment
            </label>
          </div>
        </FilterPanel>
      )}

      {/* First-connect TTV callout — shown exactly once after the first account connects */}
      {hasConnectedMail && !firstConnectCalloutSeen && (
        /* eslint-disable lantern-i18n/no-hardcoded-string */
        <div style={{ padding: `var(--kp-space-sm) var(--kp-gutter) 0`, flexShrink: 0 }}>
          <div data-testid="first-connect-callout">
          <Callout
            variant="info"
            icon={Sparkles}
            onDismiss={dismissFirstConnectCallout}
          >
            <span style={{ fontWeight: 'var(--kp-weight-semibold)' }}>Your email is connected.</span>
            {' '}Try a search your inbox never could.{' '}
            <button
              type="button"
              data-testid="first-connect-callout-cta"
              onClick={() => {
                dismissFirstConnectCallout();
                searchInputRef.current?.focus();
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--kp-navy)',
                fontWeight: 'var(--kp-weight-semibold)',
                cursor: 'pointer',
                fontSize: 'inherit',
                textDecoration: 'underline',
                fontFamily: 'inherit',
              }}
            >
              Search by name, topic, or deadline
            </button>
          </Callout>
          </div>
        </div>
        /* eslint-enable lantern-i18n/no-hardcoded-string */
      )}

      {/* Sync stall / timeout warnings — surfaced separately from the per-row
          search error below since a stuck sync is not a search failure. */}
      {syncStalled && (
        /* eslint-disable lantern-i18n/no-hardcoded-string */
        <div data-testid="email-sync-stalled" style={{ padding: `var(--kp-space-sm) var(--kp-gutter) 0`, flexShrink: 0 }}>
          <Callout variant="warning" icon={AlertTriangle}>
            This is taking longer than expected. The sync is still running in the background.
          </Callout>
        </div>
        /* eslint-enable lantern-i18n/no-hardcoded-string */
      )}
      {syncError && (
        <div data-testid="email-sync-error" style={{ padding: `var(--kp-space-sm) var(--kp-gutter) 0`, flexShrink: 0 }}>
          <Callout variant="error" icon={AlertTriangle}>
            {syncError}
          </Callout>
        </div>
      )}

      {/* Body */}
      {/* Codex review (P2.2, round 4, P1): this wrapper had `flex: 1` but no
          `display: flex` of its OWN — flex properties only apply to children
          of an actual flex container, so without this the results box's
          `flex: 1` (see below) was a no-op: the box just grew to fit
          `rowVirtualizer.getTotalSize()` instead of being constrained to the
          remaining page height, so the virtualizer's scroll container never
          actually scrolled and only the first virtual window of rows ever
          rendered — a busy (>40-row) inbox went blank past that window. */}
      <div data-testid="email-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* No accounts state */}
        {accountsLoaded && accounts.length === 0 && (
          <NoAccountsState onOpenSettings={onOpenSettings} />
        )}

        {/* Keyword mode */}
        {hasConnectedMail && mode === 'keyword' && (
          <>
            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <BulkActionBar
                selectedCount={selectedIds.size}
                selectedIds={selectedIds}
                onClearSelection={handleClearSelection}
                bulkMatterOpen={bulkMatterOpen}
                onBulkMatterOpenChange={setBulkMatterOpen}
              />
            )}

            {/* Loading skeleton */}
            {loading && (
              <div
                data-testid="loading-state"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
                  color: 'var(--color-muted-foreground)',
                  fontSize: 'var(--kp-font-sm)',
                }}
              >
                <Loader2
                  style={{
                    width: 'var(--kp-icon-md)',
                    height: 'var(--kp-icon-md)',
                    strokeWidth: 2,
                    animation: 'spin 1s linear infinite',
                  }}
                />
                { }
                { }
                Loading email...
                { }
                { }
              </div>
            )}

            {/* Error state */}
            {!loading && error && (
              <div
                data-testid="error-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
                  textAlign: 'center',
                }}
              >
                <AlertTriangle
                  style={{
                    width: 24,
                    height: 24,
                    color: '#f59e0b',
                    strokeWidth: 1.75,
                  }}
                />
                <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', color: 'var(--color-foreground)', fontWeight: 'var(--kp-weight-medium)' }}>
                  {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                  Could not load email
                  {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', maxWidth: 340 }}>
                  {error}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="error-retry"
                  onClick={handleRetry}
                  style={{ marginTop: 4 }}
                >
                  Try again
                </Button>
              </div>
            )}

            {/* No results state */}
            {!loading && !error && scopedItems.length === 0 && (
              <div
                data-testid="no-results-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: `var(--kp-space-2xl) var(--kp-gutter)`,
                  gap: 'var(--kp-space-xs)',
                  textAlign: 'center',
                }}
              >
                <Mail
                  style={{
                    width: 28,
                    height: 28,
                    color: 'var(--color-muted-foreground)',
                    strokeWidth: 1.5,
                  }}
                />
                <p style={{ margin: 0, fontSize: 'var(--kp-font-sm)', color: 'var(--color-foreground)', fontWeight: 'var(--kp-weight-medium)' }}>
                  {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                  No emails found
                  {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                </p>
                <p style={{ margin: 0, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                  { }
                  {query
                    ? 'Try a different keyword or adjust the filters.'
                    : embedded
                      ? "No email is filed to this client yet. Connect a mail folder for this client to see their correspondence here."
                      : 'No email has been synced yet.'}
                  { }
                </p>
                {/* Embedded scoping filters the loaded page client-side, so a
                    client's mail might sit deeper than the rows fetched so far.
                    When more rows exist, let the user keep scanning rather than
                    dead-ending on "none found" (Codex review P2). */}
                {embedded && items.length < total && (
                  <button
                    type="button"
                    data-testid="email-scoped-load-more"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    style={{
                      marginTop: 4,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--kp-font-xs)',
                      fontWeight: 'var(--kp-weight-medium)',
                      color: 'var(--kp-navy)',
                      background: '#fff',
                      border: '1px solid var(--color-border)',
                      cursor: loadingMore ? 'default' : 'pointer',
                    }}
                  >
                    {loadingMore && (
                      <Loader2 style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
                    )}
                    {loadingMore ? 'Looking...' : 'Keep looking in more email'}
                  </button>
                )}
              </div>
            )}

            {/* Results list */}
            {!loading && !error && scopedItems.length > 0 && (
              <div
                style={{
                  margin: `var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)`,
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  background: '#fff',
                  boxShadow: 'var(--kp-shadow-1)',
                  display: 'flex',
                  flexDirection: 'column',
                  // Perf (P2.2) fix (Codex review round 3): this box fills
                  // whatever space remains below the toolbar/filters/other
                  // states, the same way it did before virtualization —
                  // giving it a SMALL fixed max-height instead (as the
                  // original version of this fix did) shrank row popovers'
                  // (File/Privilege) available room from the full page down
                  // to a few hundred pixels, so a dropdown opened on any row
                  // past the first few got clipped by this box's own
                  // overflow. `flex: 1` + `minHeight: 0` restores the
                  // original, full-page-height safe zone.
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <div
                  data-testid="result-count"
                  style={{
                    padding: `var(--kp-space-2xs) var(--kp-space-md)`,
                    fontSize: 'var(--kp-font-2xs)',
                    color: 'var(--color-muted-foreground)',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'rgba(10,37,64,0.02)',
                    flexShrink: 0,
                  }}
                >
                  {embedded
                    ? `Showing ${String(scopedItems.length)} for this client`
                    : total === items.length && !query
                      ? 'All email loaded'
                      : `Showing ${String(items.length)} of ${String(total)}`}
                </div>
                <div
                  ref={scrollContainerRef}
                  data-testid="mail-list-scroll"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {shouldVirtualizeRows ? (
                    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const item = scopedItems[virtualRow.index];
                        if (!item) return null;
                        return (
                          <div
                            key={item.id}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${String(virtualRow.start)}px)`,
                            }}
                          >
                            <MailRow
                              item={item}
                              selected={selectedIds.has(item.id)}
                              anySelected={selectedIds.size > 0}
                              onToggleSelect={handleToggleSelect}
                              onSaveToWorkspace={onSaveToWorkspace}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    scopedItems.map((item) => (
                      <MailRow
                        key={item.id}
                        item={item}
                        selected={selectedIds.has(item.id)}
                        anySelected={selectedIds.size > 0}
                        onToggleSelect={handleToggleSelect}
                        onSaveToWorkspace={onSaveToWorkspace}
                      />
                    ))
                  )}
                </div>

                {/* Load more */}
                {items.length < total && (
                  <div
                    style={{
                      padding: `var(--kp-space-sm) var(--kp-space-md)`,
                      borderTop: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <button
                      type="button"
                      data-testid="load-more"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        borderRadius: 5,
                        fontSize: 'var(--kp-font-xs)',
                        fontWeight: 'var(--kp-weight-medium)',
                        color: 'var(--color-foreground)',
                        background: '#fff',
                        border: '1px solid var(--color-border)',
                        cursor: loadingMore ? 'default' : 'pointer',
                      }}
                    >
                      {loadingMore && (
                        <Loader2
                          style={{
                            width: 'var(--kp-icon-xs)',
                            height: 'var(--kp-icon-xs)',
                            strokeWidth: 2,
                            animation: 'spin 1s linear infinite',
                          }}
                        />
                      )}
                      { }
                      { }
                      {loadingMore ? 'Loading...' : `Load more (${String(total - items.length)} remaining)`}
                      { }
                      { }
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Ask mode */}
        {accountsLoaded && accounts.length > 0 && mode === 'ask' && (
          <div style={{ padding: `var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)` }}>
            {askLoading && (
              <div
                data-testid="ask-loading"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-xs)',
                  padding: `var(--kp-space-lg) 0`,
                  color: 'var(--color-muted-foreground)',
                  fontSize: 'var(--kp-font-sm)',
                }}
              >
                <Loader2
                  style={{
                    width: 'var(--kp-icon-sm)',
                    height: 'var(--kp-icon-sm)',
                    strokeWidth: 2,
                    animation: 'spin 1s linear infinite',
                  }}
                />
                { }
                { }
                Searching email...
                { }
                { }
              </div>
            )}

            {askError && (
              <div
                data-testid="ask-error"
                style={{
                  padding: `var(--kp-space-md) 0`,
                  fontSize: 'var(--kp-font-sm)',
                  color: '#b45309',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <AlertTriangle style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, flex: 'none' }} />
                {askError}
              </div>
            )}

            {/* Ask AI empty state — no query typed yet */}
            {!askLoading && !askError && !query.trim() && (
              <div
                data-testid="ask-empty-state"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: `var(--kp-space-2xl) 0 var(--kp-space-xl)`,
                  gap: 'var(--kp-space-sm)',
                  textAlign: 'center',
                }}
              >
                {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                <div
                  style={{
                    fontSize: 'var(--kp-font-lg)',
                    fontWeight: 'var(--kp-weight-bold)',
                    lineHeight: 'var(--kp-leading-tight)',
                    color: 'var(--kp-navy)',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Search your email
                </div>
                <div
                  style={{
                    fontSize: 'var(--kp-font-sm)',
                    color: 'var(--color-muted-foreground)',
                    maxWidth: 360,
                    lineHeight: 'var(--kp-leading-normal)',
                  }}
                >
                  I search across your imported email and answer with citations you can open.
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {[
                    'Who emailed about a beneficiary change?',
                    'Find statements with attachments from the custodian',
                    'What did the client agree to over email?',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      data-testid="ask-chip"
                      onClick={() => {
                        setQuery(chip);
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: 'var(--kp-font-xs)',
                        fontWeight: 'var(--kp-weight-medium)',
                        color: 'var(--kp-navy)',
                        background: 'rgba(10,37,64,0.05)',
                        border: '1px solid rgba(10,37,64,0.14)',
                        cursor: 'pointer',
                        fontFamily: 'var(--font-sans)',
                        transition: 'background 0.1s, border-color 0.1s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,37,64,0.09)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(10,37,64,0.22)';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(10,37,64,0.05)';
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(10,37,64,0.14)';
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                {/* eslint-enable lantern-i18n/no-hardcoded-string */}
              </div>
            )}

            {!askLoading && !askError && askHits.length === 0 && query.trim() && (
              <div
                data-testid="ask-no-results"
                style={{
                  padding: `var(--kp-space-lg) 0`,
                  fontSize: 'var(--kp-font-sm)',
                  color: 'var(--color-muted-foreground)',
                  textAlign: 'center',
                  lineHeight: 'var(--kp-leading-relaxed)',
                }}
              >
                {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                {!isMemoryEnabled() ? (
                  <span>
                    AI search needs memory enabled.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } }));
                        onOpenSettings?.();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--kp-navy)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      Enable it in Settings
                    </button>
                    .
                  </span>
                ) : activeMatter && !scopeAllEmail && embedded ? (
                  <span>
                    No email is filed to this client yet. Connect a mail folder for this client to search their correspondence.
                  </span>
                ) : activeMatter && !scopeAllEmail ? (
                  <span>
                    No email is filed to this matter yet.{' '}
                    <button
                      type="button"
                      data-testid="ask-no-results-switch-scope"
                      onClick={() => { setScopeAllEmail(true); }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--kp-navy)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        cursor: 'pointer',
                        fontSize: 'inherit',
                        textDecoration: 'underline',
                      }}
                    >
                      Switch to All email
                    </button>
                    {' '}above, or file emails to this matter with the File button.
                  </span>
                ) : (
                  'No matching email found for your question.'
                )}
                {/* eslint-enable lantern-i18n/no-hardcoded-string */}
              </div>
            )}

            {!askLoading && !askError && askHits.map((hit, i) => (
              <AskHitCard key={hit.sourceId ?? hit.path} hit={hit} rank={i + 1} items={items} />
            ))}
          </div>
        )}
      </div>

      {/* Compose modal — always mounted so draft text survives close/reopen */}
      <ComposeModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        accounts={accounts}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
