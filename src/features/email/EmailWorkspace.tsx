/**
 * EmailWorkspace — full-page email search and browse surface.
 *
 * Two modes:
 *   Search  — debounced mailListMessages() with provider / date / attachment
 *             filters; paginated "Load more" (offset += 50).
 *   Ask AI  — MemoryService.retrieve() scoped to mail: sourceIds; results
 *             ranked by similarity score.
 *
 * Per-row actions: Open (dispatches keepance:open-email), File to matter
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

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mail,
  Search,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Paperclip,
  FolderInput,
  X,
  PenLine,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { Button, SearchField, SegmentedToggle, FilterToggle, FilterPanel, SurfaceToolbar, Callout } from '@/ui/kp';
import { useActiveMatter, getMatters } from '@/platform/matter/matterStore';
import { resolveMailMatter } from '@/platform/rag/matterResolver';
import { useMailStore } from './mailStore';
import {
  mailListMessages,
  mailConnectedAccounts,
  mailSend,
  mailSyncAll,
  MAIL_SYNC_EVENT,
  type MailListItem,
  type ConnectedAccount,
  type MailAttachmentInput,
  type MailSyncProgress,
} from '@/platform/utils/mail-commands';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { mapMailError, parseRecipients, filterInputStyle } from './emailWorkspaceHelpers';
import { BulkMatterPicker } from './BulkMatterPicker';
import { AskHitCard } from './AskHitCard';
import { NoAccountsState } from './NoAccountsState';
import { MailRow } from './MailRow';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';

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

// ── Helpers ────────────────────────────────────────────────────────────────
// (pure helpers moved to ./emailWorkspaceHelpers)

function sanitizeConnectedAccounts(accounts: ConnectedAccount[]): ConnectedAccount[] {
  const byKey = new Map<string, ConnectedAccount>();
  for (const account of accounts) {
    const provider = account.provider.trim();
    const accountId = account.account.trim();
    if (!provider || !accountId) continue;
    const key = `${provider}:${accountId}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...account, provider, account: accountId });
    }
  }
  return Array.from(byKey.values());
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

  // Track whether a manual/startup sync is in flight (cross-provider aggregate).
  const [syncing, setSyncing] = useState(false);

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

  // Connected accounts (loaded once on mount)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const hasConnectedMail = accountsLoaded && accounts.length > 0;

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

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMatterOpen, setBulkMatterOpen] = useState(false);

  // Compose state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeProvider, setComposeProvider] = useState('');
  const [composeAccount, setComposeAccount] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeSendResult, setComposeSendResult] = useState<'none' | 'success' | 'error' | 'scope_upgrade'>('none');
  const [composeSendError, setComposeSendError] = useState<string | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<MailAttachmentInput[]>([]);
  const attachFileRef = useRef<HTMLInputElement>(null);

  // Ref for focusing the search field from the first-connect callout CTA.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close the compose modal when Escape is pressed.
  useEffect(() => {
    if (!composeOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setComposeOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [composeOpen]);

  // Debounce ref and request fingerprint tracking
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef(0);
  // Fingerprint tracks query/filter params (not offset) to detect filter changes in Effect B
  const queryFingerprintRef = useRef('');

  // Load connected accounts on mount and re-check on window focus so the view
  // updates automatically after the user connects an account in the Account window.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      mailConnectedAccounts()
        .then((accs) => {
          if (!cancelled) {
            const nextAccounts = sanitizeConnectedAccounts(accs);
            setAccounts(nextAccounts);
            if (nextAccounts.length === 0) {
              setSyncing(false);
              setItems([]);
              setTotal(0);
              setOffset(0);
              setError(null);
              setAskHits([]);
              setAskLoading(false);
              setAskError(null);
            }
            setAccountsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAccounts([]);
            setAccountsLoaded(true);
          }
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  // BUG-007: Auto-sync on mount when already connected but no sync has run yet.
  // `mail_sync_all` only fires at connect-time; after an app restart the account
  // shows as Connected but the Email tab is empty with no way to refresh. This
  // effect fires once after accounts are resolved: if there are connected accounts
  // and we're running inside Tauri (desktop-only), kick off a background sync.
  // Guard: skip if already syncing (prevents double-fire on HMR / strict-mode).
  const startupSyncFiredRef = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    if (!accountsLoaded) return;
    if (accounts.length === 0) return;
    if (startupSyncFiredRef.current) return;
    startupSyncFiredRef.current = true;
    setSyncing(true);
    mailSyncAll(buildMailMatterMap(getMatters()))
      .catch(() => { /* surfaced via the MAIL_SYNC_EVENT error status */ })
      .finally(() => { setSyncing(false); });
  }, [accountsLoaded, accounts.length]);

  // Re-query the message list when a sync finishes or this window regains focus.
  // The connectors live in a SEPARATE window, so mail imported there lands in the
  // shared encrypted store while this window's list still shows the pre-import
  // state — without this, an import of hundreds of messages never appears here
  // until a manual filter change. `setRetryCount` re-runs the keyword query
  // (Effect A) from the first page. (`accounts` is intentionally not an Effect-A
  // dependency, so updating it alone would not refresh the list.)
  useEffect(() => {
    const refresh = () => setRetryCount((c) => c + 1);
    window.addEventListener('focus', refresh);
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if (isTauri()) {
      listen<MailSyncProgress>(MAIL_SYNC_EVENT, (e) => {
        if (e.payload.status === 'done') refresh();
      })
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      if (unlisten) unlisten();
    };
  }, []);

  // Auto-select first account when compose opens and accounts are available
  useEffect(() => {
    if (composeOpen && composeProvider === '' && accounts.length > 0) {
      const first = accounts[0];
      if (first) {
        setComposeProvider(first.provider);
        setComposeAccount(first.account);
      }
    }
  }, [composeOpen, accounts, composeProvider]);

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
  }, [mode, accountsLoaded, accounts.length, query, providerFilter, dateFrom, dateTo, hasAttachments, retryCount]);

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

  // BUG-007: Manual "Sync now" — calls mailSyncAll for all connected providers.
  // Disabled while a sync is already in flight (syncing state) or outside Tauri.
  const handleSyncNow = useCallback(() => {
    if (!isTauri()) return;
    if (syncing) return;
    setSyncing(true);
    mailSyncAll(buildMailMatterMap(getMatters()))
      .catch(() => { /* error status surfaced via MAIL_SYNC_EVENT listener */ })
      .finally(() => { setSyncing(false); });
  }, [syncing]);

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
  const scopedItems = embedded && activeMatter
    ? items.filter((m) => resolveMailMatter(getMatters(), m.provider, m.account, m.folderId) === activeMatter.id)
    : items;

  // Fix 7: persist list scroll position per-matter in sessionStorage
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollKey = `email-scroll-${activeMatter?.id ?? 'all'}`;

  // Restore scroll on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = Number(saved);
    }
    // Save scroll on unmount
    const el = scrollContainerRef.current;
    return () => {
      if (el) {
        sessionStorage.setItem(scrollKey, String(el.scrollTop));
      }
    };
  }, [scrollKey]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollContainerRef}
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
          onClick={() => {
            setComposeOpen(true);
            setComposeSendResult('none');
            setComposeSendError(null);
            setComposeAttachments([]);
          }}
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
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          {syncing ? 'Syncing…' : 'Sync now'}
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
        /* eslint-disable keepance-i18n/no-hardcoded-string */
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
        /* eslint-enable keepance-i18n/no-hardcoded-string */
      )}

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* No accounts state */}
        {accountsLoaded && accounts.length === 0 && (
          <NoAccountsState onOpenSettings={onOpenSettings} />
        )}

        {/* Keyword mode */}
        {hasConnectedMail && mode === 'keyword' && (
          <>
            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div
                data-testid="bulk-action-bar"
                style={{
                  margin: `var(--kp-space-md) var(--kp-gutter) var(--kp-space-xs)`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 'var(--kp-space-xs) var(--kp-space-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(10,37,64,0.18)',
                  background: 'rgba(10,37,64,0.04)',
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--kp-navy)',
                  fontWeight: 'var(--kp-weight-medium)',
                }}
              >
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                <span style={{ flex: 1 }}>
                  {selectedIds.size} selected
                </span>
                <div style={{ position: 'relative' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={FolderInput}
                    iconRight={ChevronDown}
                    data-testid="bulk-file-to-matter"
                    onClick={() => { setBulkMatterOpen((o) => !o); }}
                  >
                    File to matter
                  </Button>
                  <BulkMatterPicker
                    selectedIds={selectedIds}
                    open={bulkMatterOpen}
                    onOpenChange={setBulkMatterOpen}
                    onDone={handleClearSelection}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={X}
                  onClick={handleClearSelection}
                >
                  Clear selection
                </Button>
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
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
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  Could not load email
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                  {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                  No emails found
                  {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                    {/* eslint-disable-next-line keepance-i18n/no-hardcoded-string */}
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
                  overflow: 'hidden',
                  boxShadow: 'var(--kp-shadow-1)',
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
                  }}
                >
                  {embedded
                    ? `Showing ${String(scopedItems.length)} for this client`
                    : total === items.length && !query
                      ? 'All email loaded'
                      : `Showing ${String(items.length)} of ${String(total)}`}
                </div>
                {scopedItems.map((item) => (
                  <MailRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    anySelected={selectedIds.size > 0}
                    onToggleSelect={handleToggleSelect}
                    onSaveToWorkspace={onSaveToWorkspace}
                  />
                ))}

                {/* Load more */}
                {items.length < total && (
                  <div
                    style={{
                      padding: `var(--kp-space-sm) var(--kp-space-md)`,
                      borderTop: '1px solid var(--color-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
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
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
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
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                {!isMemoryEnabled() ? (
                  <span>
                    AI search needs memory enabled.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('keepance:open-settings', { detail: { category: 'ai' } }));
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
                {/* eslint-enable keepance-i18n/no-hardcoded-string */}
              </div>
            )}

            {!askLoading && !askError && askHits.map((hit, i) => (
              <AskHitCard key={hit.sourceId ?? hit.path} hit={hit} rank={i + 1} items={items} />
            ))}
          </div>
        )}
      </div>

      {/* Compose modal */}
      {composeOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setComposeOpen(false);
            }
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          <div
            style={{
              background: '#fff',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--kp-shadow-3)',
              width: 560,
              maxWidth: '95vw',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-space-xs)`,
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)' }}>
                New email
              </span>
              <button
                type="button"
                data-testid="compose-close"
                onClick={() => { setComposeOpen(false); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-muted-foreground)',
                  borderRadius: 4,
                }}
              >
                <X style={{ width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', strokeWidth: 2 }} />
              </button>
            </div>

            {/* Modal body (scrollable) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-card-pad)`, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
              {/* From selector */}
              {accounts.length === 0 ? (
                <div data-testid="compose-no-accounts" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
                  Connect an account first in Settings.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                    From
                  </span>
                  <select
                    value={`${composeProvider}::${composeAccount}`}
                    onChange={(e) => {
                      const [p = '', a = ''] = e.target.value.split('::');
                      setComposeProvider(p);
                      setComposeAccount(a);
                    }}
                    style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                  >
                    {accounts.map((acc) => (
                      <option key={`${acc.provider}::${acc.account}`} value={`${acc.provider}::${acc.account}`}>
                        {acc.label} ({acc.account})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* To field */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  To
                </span>
                <input
                  type="text"
                  data-testid="compose-to"
                  value={composeTo}
                  onChange={(e) => { setComposeTo(e.target.value); }}
                  placeholder="recipient@example.com"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
                <button
                  type="button"
                  data-testid="compose-cc-bcc-toggle"
                  onClick={() => { setComposeCcBccOpen((o) => !o); }}
                  style={{ flexShrink: 0, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  Cc / Bcc
                </button>
              </div>

              {/* Cc / Bcc */}
              {composeCcBccOpen && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Cc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-cc"
                      value={composeCc}
                      onChange={(e) => { setComposeCc(e.target.value); }}
                      placeholder="cc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                      Bcc
                    </span>
                    <input
                      type="text"
                      data-testid="compose-bcc"
                      value={composeBcc}
                      onChange={(e) => { setComposeBcc(e.target.value); }}
                      placeholder="bcc@example.com"
                      style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                    />
                  </div>
                </>
              )}

              {/* Subject */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 50, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  Subject
                </span>
                <input
                  type="text"
                  data-testid="compose-subject"
                  value={composeSubject}
                  onChange={(e) => { setComposeSubject(e.target.value); }}
                  placeholder="Subject"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
              </div>

              {/* Body */}
              <textarea
                data-testid="compose-body"
                value={composeBody}
                onChange={(e) => { setComposeBody(e.target.value); }}
                placeholder="Write your message..."
                rows={10}
                style={{
                  width: '100%',
                  border: '1px solid var(--color-border)',
                  borderRadius: 5,
                  padding: '8px',
                  fontSize: 'var(--kp-font-sm)',
                  lineHeight: 'var(--kp-leading-normal)',
                  fontFamily: 'var(--font-sans)',
                  background: '#fff',
                  color: 'var(--color-foreground)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />

              {/* Attachments */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    data-testid="compose-attach"
                    onClick={() => { attachFileRef.current?.click(); }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 5,
                      fontSize: 'var(--kp-font-xs)',
                      fontWeight: 'var(--kp-weight-medium)',
                      background: 'transparent',
                      color: 'var(--color-muted-foreground)',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
                    Attach
                  </button>
                  <input
                    ref={attachFileRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    data-testid="compose-attach-input"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      files.forEach((file) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                          const dataUrl = reader.result as string;
                          // dataUrl is "data:<mime>;base64,<data>"
                          const b64 = dataUrl.split(',')[1] ?? '';
                          setComposeAttachments((prev) => [
                            ...prev,
                            { name: file.name, contentBase64: b64, contentType: file.type || 'application/octet-stream' },
                          ]);
                        };
                        reader.readAsDataURL(file);
                      });
                      // Reset so the same file can be re-added after removal
                      e.target.value = '';
                    }}
                  />
                </div>
                {composeAttachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {composeAttachments.map((att, idx) => (
                      <div
                        key={`${att.name}-${String(idx)}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontSize: 'var(--kp-font-2xs)',
                          background: '#f0f4ff',
                          border: '1px solid var(--color-border)',
                          color: 'var(--color-foreground)',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, color: 'var(--color-muted-foreground)' }} />
                        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {att.name}
                        </span>
                        <button
                          type="button"
                          data-testid={`compose-remove-attachment-${String(idx)}`}
                          onClick={() => {
                            setComposeAttachments((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            display: 'flex',
                            color: 'var(--color-muted-foreground)',
                          }}
                        >
                          <X style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Send result states */}
              {composeSendResult === 'success' && (
                <div data-testid="compose-success" style={{ fontSize: 'var(--kp-font-xs)', color: '#047857' }}>
                  Email sent
                </div>
              )}
              {composeSendResult === 'error' && composeSendError && (
                <div data-testid="compose-error" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
                  {composeSendError}
                </div>
              )}
              {composeSendResult === 'scope_upgrade' && (
                <div data-testid="compose-scope-upgrade" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309' }}>
                  Sending needs a one-time reconnect for the send permission. Go to Settings to reconnect your email.
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      style={{
                        display: 'block',
                        marginTop: 6,
                        padding: '4px 10px',
                        borderRadius: 5,
                        fontSize: 'var(--kp-font-2xs)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        background: 'transparent',
                        color: 'var(--kp-navy)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Go to Settings
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div
              style={{
                padding: `var(--kp-space-xs) var(--kp-card-pad)`,
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                data-testid="compose-send"
                disabled={composeSending || accounts.length === 0}
                onClick={() => {
                  const toArr = parseRecipients(composeTo);
                  const ccArr = parseRecipients(composeCc);
                  const bccArr = parseRecipients(composeBcc);
                  setComposeSending(true);
                  setComposeSendResult('none');
                  setComposeSendError(null);
                  void mailSend(composeProvider, composeAccount, toArr, ccArr, bccArr, composeSubject, composeBody, undefined, composeAttachments.length > 0 ? composeAttachments : undefined)
                    .then(() => {
                      setComposeSending(false);
                      setComposeSendResult('success');
                      setTimeout(() => {
                        setComposeOpen(false);
                        setComposeTo('');
                        setComposeCc('');
                        setComposeBcc('');
                        setComposeSubject('');
                        setComposeBody('');
                        setComposeCcBccOpen(false);
                        setComposeSendResult('none');
                        setComposeSendError(null);
                        setComposeAttachments([]);
                      }, 1500);
                    })
                    .catch((e: unknown) => {
                      setComposeSending(false);
                      const msg = e instanceof Error ? e.message : '';
                      if (msg.includes('scope_upgrade_required')) {
                        setComposeSendResult('scope_upgrade');
                      } else {
                        setComposeSendResult('error');
                        setComposeSendError(mapMailError(e));
                      }
                    });
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 18px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--kp-font-sm)',
                  fontWeight: 'var(--kp-weight-semibold)',
                  background: 'var(--kp-navy)',
                  color: '#fff',
                  border: 'none',
                  cursor: composeSending || accounts.length === 0 ? 'default' : 'pointer',
                  opacity: composeSending || accounts.length === 0 ? 0.6 : 1,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {composeSending && (
                  <Loader2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
                )}
                Send
              </button>
            </div>
          </div>
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </div>
      )}
    </div>
  );
}
