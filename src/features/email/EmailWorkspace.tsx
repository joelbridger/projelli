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
 * Privilege (dropdown), Save email (via the reader menu).
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
import {
  Mail,
  Loader2,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ExternalLink,
  Paperclip,
  ShieldCheck,
  Square,
  CheckSquare,
  Check,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@tauri-apps/api/core';
import { Button, FilterPanel, Callout, RailShell, RailShellHeader, IconButton, Badge } from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useMatters } from '@/platform/matter/matterStore';
import {
  readSelectionOperationDecision,
  useSelectionOperationDecision,
} from '@/platform/client-context';
import { buildMailMatterMap, type MailMatterMapEntry } from '@/platform/rag/matterResolver';
import { useMailStore } from './mailStore';
import {
  mailListMessages,
  mailListMessagesByMatter,
  type MailListItem,
  type MailListPage,
  type MailListQuery,
} from '@/platform/utils/mail-commands';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { mapMailError, filterInputStyle, formatRelativeDate } from './emailWorkspaceHelpers';
import { AskHitCard } from './AskHitCard';
import { NoAccountsState } from './NoAccountsState';
import { EmailViewer } from './EmailViewer';
import { sendDiagnosticEvent } from '@/platform/utils/diagnostics';
import { ComposeModal } from './ComposeModal';
import type { EmailComposeHandoff } from './composeHandoff';
import { BulkActionBar } from './BulkActionBar';
import { useAccountSync } from './useAccountSync';
import { EV_OPEN_EMAIL, EV_OPEN_SETTINGS } from '@/config/identity';
import { usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { isPrivileged } from '@/platform/types/privilege';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';

// Stable empty map for the non-embedded (global) surface, so `mailMatterMap`
// keeps the same reference across `matters` changes and never retriggers the
// global list fetch. (Embedded builds a real map from `matters`.)
const EMPTY_MAIL_MATTER_MAP: MailMatterMapEntry[] = [];
const EMAIL_RAIL_VIRTUALIZE_ROW_THRESHOLD = 40;
const EMAIL_RAIL_ROW_ESTIMATED_HEIGHT_PX = 88;
const EMAIL_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

class EmailSelectionRefusal extends Error {}

function providerDisplayLabel(provider: string, t: (key: string) => string): string {
  const normalized = provider.toLowerCase();
  if (normalized === 'gmail' || normalized === 'google') return t('mail.workspace.provider-gmail');
  if (normalized === 'm365' || normalized === 'outlook' || normalized === 'microsoft') {
    return t('mail.workspace.provider-outlook');
  }
  return provider;
}

interface EmailRailRowProps {
  item: MailListItem;
  subjectLabel: string;
  bulkSelected: boolean;
  anyBulkSelected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenInTab: (id: string) => void;
  selectLabel: string;
  openLabel: string;
}

function EmailRailRow({
  item,
  subjectLabel,
  bulkSelected,
  anyBulkSelected,
  onToggleSelect,
  onOpenInTab,
  selectLabel,
  openLabel,
}: EmailRailRowProps) {
  const fromLabel = item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr;
  const checkboxVisible = anyBulkSelected || bulkSelected;
  const entityLabel = useEntityLabelEnglish();
  const privilege = usePrivilegeForSource(`mail:${item.id}`);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={bulkSelected}
          aria-label={selectLabel}
          data-testid={`select-email-${item.id}`}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-transparent text-[var(--color-muted-foreground)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--kp-navy)] ${
            checkboxVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(item.id);
          }}
        >
          {bulkSelected ? (
            <CheckSquare className="h-3.5 w-3.5 text-[var(--kp-navy)]" strokeWidth={1.75} />
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-[length:var(--kp-rail-row-title-font-size)] font-semibold leading-snug text-[var(--kp-navy)]">
              {subjectLabel}
            </span>
            <span className="shrink-0 text-[length:var(--kp-rail-row-meta-font-size)] leading-snug text-[var(--color-muted-foreground)]">
              {formatRelativeDate(item.receivedDateTime)}
            </span>
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[length:var(--kp-rail-row-meta-font-size)] text-[var(--color-muted-foreground)]">
              {fromLabel}
            </span>
            {item.hasAttachments ? (
              <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" strokeWidth={1.75} />
            ) : null}
            {isPrivileged(privilege) ? (
              <Badge
                variant="privilege"
                size="sm"
                icon={ShieldCheck}
                data-testid={`email-rail-sensitive-${item.id}`}
                className="shrink-0"
              >
                {entityLabel.confidentialityBadge}
              </Badge>
            ) : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreVertical}
              label={openLabel}
              size="xs"
              variant="ghost"
              data-testid={`email-rail-actions-${item.id}`}
              className="mt-0.5 opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem
              data-testid={`email-rail-open-${item.id}`}
              onSelect={() => { onOpenInTab(item.id); }}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              {openLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {item.snippet ? (
        <div className="line-clamp-1 pl-7 text-[length:var(--kp-rail-row-meta-font-size)] leading-snug text-[var(--kp-side-fg-dim)] group-hover:line-clamp-2 group-focus:line-clamp-2 group-focus-within:line-clamp-2">
          {item.snippet}
        </div>
      ) : null}
    </div>
  );
}

interface EmailFixturePreviewProps {
  item: MailListItem;
  subjectLabel: string;
  previewLabel: string;
  previewNote: string;
}

function EmailFixturePreview({
  item,
  subjectLabel,
  previewLabel,
  previewNote,
}: EmailFixturePreviewProps) {
  const fromLabel = item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-start gap-2">
          <Mail className="mt-1 h-5 w-5 shrink-0 text-[var(--kp-navy)]" strokeWidth={1.75} />
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-semibold leading-tight text-slate-900">
              {subjectLabel}
            </h1>
            <p className="mt-1 text-xs font-medium uppercase text-[var(--color-muted-foreground)]">
              {previewLabel}
            </p>
          </div>
        </div>
        <div className="mt-4 text-sm">
          <div className="font-medium text-slate-900">{fromLabel}</div>
          <div className="mt-1 text-xs text-slate-500">{formatRelativeDate(item.receivedDateTime)}</div>
        </div>
        {item.snippet ? (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <p className="m-0 text-sm leading-relaxed text-slate-800">{item.snippet}</p>
          </div>
        ) : null}
        <p className="mt-5 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
          {previewNote}
        </p>
      </div>
    </div>
  );
}

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
  /** One-shot request from a household record to open the existing compose flow. */
  composeHandoff?: EmailComposeHandoff;
  onComposeHandoffConsumed?: (() => void) | undefined;
}

// ── No-accounts empty state ────────────────────────────────────────────────

// ── Main export ────────────────────────────────────────────────────────────

export function EmailWorkspace({
  onSaveToWorkspace,
  onOpenSettings,
  embedded = false,
  composeHandoff,
  onComposeHandoffConsumed,
}: EmailWorkspaceProps) {
  const { t } = useTranslation();
  const selection = useSelectionOperationDecision(EMAIL_SELECTION_REQUEST);
  const activeMatter = selection.kind === 'matter' ? selection.matter : null;

  // One page size everywhere. Embedded (per-client) browse is now scoped in the
  // BACKEND (F2.6b `mailListMessagesByMatter`), so a client's mail is paged
  // directly — no need to over-fetch a deep page hoping the client's rows are
  // among the newest, and no client-side filter-of-a-global-page.
  const PAGE_SIZE = 50;

  // Reactive folder→matter map (embedded only). Subscribing to `matters` means a
  // folder remap re-renders this tab and re-runs the list effect, so the scoped
  // view can't linger on a stale mapping.
  const matters = useMatters();
  const mailMatterMap = useMemo(
    () => (embedded ? buildMailMatterMap(matters) : EMPTY_MAIL_MATTER_MAP),
    [embedded, matters],
  );

  // A fingerprint of the EXACT scope the current rows were fetched under: the
  // active client id + the full folder→matter map. Any change (client switch,
  // folder remap) makes this differ from the scope the loaded rows belong to, so
  // the render gate below drops them instantly. Non-embedded has no scope.
  const scopeKey = embedded ? `${activeMatter?.id ?? ''}::${JSON.stringify(mailMatterMap)}` : 'global';
  // The scope the rows currently in `items` were actually fetched under.
  const [loadedScope, setLoadedScope] = useState('');

  // In embedded mode the list is scoped to the active client in the engine; the
  // global surface uses the unscoped list. Both share the query/sort/pagination
  // logic below; only the backend call differs.
  //
  // FAIL CLOSED (isolation-critical): the embedded per-client tab must NEVER call
  // the unscoped global list. If it mounts while `activeMatter` is momentarily
  // null/stale, return an empty page rather than risk rendering another client's
  // mail inside a client tab (the client-side filter that used to backstop this
  // is intentionally gone — scoping is the backend's job now).
  const runList = useCallback(
    (listQuery: MailListQuery): Promise<MailListPage> => {
      const current = readSelectionOperationDecision({
        ...EMAIL_SELECTION_REQUEST,
        ...(embedded && activeMatter
          ? { expectedScope: { kind: 'matter' as const, matterId: activeMatter.id } }
          : {}),
      });
      if (current.kind === 'refused') {
        return Promise.reject(new EmailSelectionRefusal(current.message));
      }
      if (embedded) {
        if (current.kind !== 'matter') {
          return Promise.reject(new Error('Choose one client to read its email.'));
        }
        return mailListMessagesByMatter(current.matter.id, mailMatterMap, listQuery);
      }
      return mailListMessages(listQuery);
    },
    [embedded, activeMatter, mailMatterMap],
  );

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
  const {
    syncing,
    syncStalled,
    syncError,
    syncImportedMessages,
    accounts,
    accountsLoaded,
    accountLoadError,
    hasConnectedMail,
    handleSyncNow,
  } = useAccountSync({
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
  const [composeHouseholdContext, setComposeHouseholdContext] = useState<string | null>(null);
  const [composeHandoffMessage, setComposeHandoffMessage] = useState<string | null>(null);
  const consumedComposeHandoffRef = useRef<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);

  // A household record may request the already-owned compose flow. Browser
  // preview deliberately stops at a clear desktop boundary instead of looking
  // like it drafted an email it cannot send.
  useEffect(() => {
    if (!composeHandoff) return;
    const handoffKey = `${composeHandoff.source}:${composeHandoff.household.id}`;
    if (consumedComposeHandoffRef.current === handoffKey) return;
    if (!isTauri()) {
      consumedComposeHandoffRef.current = handoffKey;
      setComposeHandoffMessage(`Email drafts open in the desktop app. Open ${composeHandoff.household.label} there to draft an email.`);
      onComposeHandoffConsumed?.();
      return;
    }
    if (!accountsLoaded) return;

    consumedComposeHandoffRef.current = handoffKey;
    if (accountLoadError) {
      setComposeHandoffMessage('We could not check your email connection, so no draft was opened. Try again in the desktop app.');
    } else if (accounts.length === 0) {
      setComposeHandoffMessage(`No email account is connected. Connect one in the desktop app, then draft an email for ${composeHandoff.household.label}.`);
    } else {
      setComposeHandoffMessage(null);
      setComposeHouseholdContext(composeHandoff.household.label);
      setComposeOpen(true);
    }
    onComposeHandoffConsumed?.();
  }, [accountLoadError, accounts.length, accountsLoaded, composeHandoff, onComposeHandoffConsumed]);

  const handleComposeOpenChange = useCallback((open: boolean) => {
    setComposeOpen(open);
    if (!open) setComposeHouseholdContext(null);
  }, []);

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

        const result = await runList(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems(result.items);
        setTotal(result.total);
        setLoadedScope(scopeKey);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(e instanceof EmailSelectionRefusal ? e.message : mapMailError(e));
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
  }, [mode, accountsLoaded, accounts.length, query, providerFilter, dateFrom, dateTo, hasAttachments, retryCount, PAGE_SIZE, runList, scopeKey]);

  // Effect B: fires immediately when offset > 0 (load-more), but only if the
  // fingerprint hasn't changed (i.e., purely a pagination action, not a filter change).
  useEffect(() => {
    if (offset === 0) return; // first page is handled by Effect A
    if (mode !== 'keyword') return;
    if (!accountsLoaded) return;
    if (accounts.length === 0) return;
    // Never append a page under a changed scope onto rows from the old scope
    // (isolation): Effect A's scope-triggered refetch resets offset and reloads.
    if (embedded && loadedScope !== scopeKey) return;

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

        const result = await runList(listQuery);

        if (latestQueryRef.current !== thisQuery) return;

        setItems((prev) => [...prev, ...result.items]);
        setTotal(result.total);
        setLoadedScope(scopeKey);
      } catch (e: unknown) {
        if (latestQueryRef.current !== thisQuery) return;
        setError(e instanceof EmailSelectionRefusal ? e.message : mapMailError(e));
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
    const currentSelection = readSelectionOperationDecision({
      ...EMAIL_SELECTION_REQUEST,
      ...(embedded && activeMatter
        ? { expectedScope: { kind: 'matter' as const, matterId: activeMatter.id } }
        : {}),
    });
    if (currentSelection.kind === 'refused') {
      setAskHits([]);
      setAskLoading(false);
      setAskError(currentSelection.message);
      return;
    }
    if (!hasConnectedMail) {
      setAskHits([]);
      setAskLoading(false);
      setAskError(null);
      return;
    }
    // FAIL CLOSED (isolation): the embedded per-client tab must never run an
    // all-clients retrieval. If it has no active client (momentary null / initial
    // mount / mid-switch), show no hits rather than risk another client's mail
    // surfacing here — mirrors the keyword `runList` guard above.
    if (embedded && currentSelection.kind !== 'matter') {
      setAskHits([]);
      setAskLoading(false);
      setAskError('Choose one client to search its email.');
      return;
    }
    if (!query.trim()) {
      setAskHits([]);
      return;
    }
    if (!isMemoryEnabled()) {
      setAskError(t('mail.workspace.ask-memory-disabled'));
      return;
    }

    let cancelled = false;
    const thisQuery = ++latestQueryRef.current;
    setAskLoading(true);
    setAskError(null);

    // Embedded mode is ALWAYS scoped to the active client (the "All email" toggle
    // is hidden here, so `scopeAllEmail` is ignored) — never allMatters. The
    // global surface keeps the toggle: matter scope unless the user opts into all.
    // (`embedded && !activeMatter` already returned above, so in the embedded
    // branch `activeMatter` is non-null.)
    let scope: RetrievalScope;
    if (embedded && currentSelection.kind === 'matter') {
      scope = { kind: 'matter', matterId: currentSelection.matter.id };
    } else if (activeMatter && !scopeAllEmail) {
      scope = { kind: 'matter', matterId: activeMatter.id };
    } else {
      scope = { kind: 'allMatters' };
    }

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
          e instanceof Error ? e.message : t('mail.workspace.ask-retrieval-failed'),
        );
      })
      .finally(() => {
        if (!cancelled && latestQueryRef.current === thisQuery) {
          setAskLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [mode, query, activeMatter, scopeAllEmail, hasConnectedMail, embedded, t]);

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

  // F2.6b: per-client scoping now happens in the BACKEND (`runList` above calls
  // `mailListMessagesByMatter` in embedded mode), which combines each message's
  // durable filing with the folder→matter mapping — so `items` is already exactly
  // this client's mail (per-message filings included, other clients excluded) and
  // `total` is honest. No client-side filter of a global page (the old
  // `resolveMailMatter` scan is gone). AI search (Ask mode) is separately
  // matter-scoped via RetrievalScope.
  //
  // FAIL CLOSED at render too: only trust rows that were fetched under the CURRENT
  // scope. If the scope changed (client switch, folder remap, or a momentarily
  // null client) the loaded rows belong to a different scope. `scopeMatches` gates
  // BOTH what we render AND whether load-more may run — so stale rows drop
  // instantly and a load-more can't append a new-scope page onto old rows before
  // the debounced first-page refetch replaces them. `runList` additionally refuses
  // to fetch when there's no active client.
  //
  const scopeMatches = !embedded || loadedScope === scopeKey;
  const scopedItems = useMemo(
    () => (scopeMatches ? items : []),
    [scopeMatches, items],
  );

  const effectiveSelectedEmailId = useMemo(() => {
    if (mode !== 'keyword' || scopedItems.length === 0) return null;
    if (selectedEmailId && scopedItems.some((item) => item.id === selectedEmailId)) {
      return selectedEmailId;
    }
    return scopedItems[0]?.id ?? null;
  }, [mode, scopedItems, selectedEmailId]);

  useEffect(() => {
    if (mode !== 'keyword' || loading || error || scopedItems.length === 0) {
      if (mode === 'keyword' && scopedItems.length === 0 && selectedEmailId !== null) {
        setSelectedEmailId(null);
      }
      return;
    }
    if (!selectedEmailId || !scopedItems.some((item) => item.id === selectedEmailId)) {
      setSelectedEmailId(scopedItems[0]?.id ?? null);
    }
  }, [mode, loading, error, scopedItems, selectedEmailId]);

  const handleOpenEmailInTab = useCallback((id: string) => {
    window.dispatchEvent(
      new CustomEvent(EV_OPEN_EMAIL, {
        detail: { sourceId: `mail:${id}` },
      }),
    );
  }, []);

  const railItems = useMemo(
    () => scopedItems.map((item) => ({
      id: item.id,
      label: item.subject || t('mail.workspace.no-subject'),
      testId: `email-rail-row-${item.id}`,
      ariaLabel: item.subject || t('mail.workspace.no-subject'),
      content: (
        <EmailRailRow
          item={item}
          subjectLabel={item.subject || t('mail.workspace.no-subject')}
          bulkSelected={selectedIds.has(item.id)}
          anyBulkSelected={selectedIds.size > 0}
          onToggleSelect={handleToggleSelect}
          onOpenInTab={handleOpenEmailInTab}
          selectLabel={t('mail.workspace.select-email', { subject: item.subject || t('mail.workspace.no-subject') })}
          openLabel={t('mail.workspace.open-in-tab')}
        />
      ),
    })),
    [scopedItems, selectedIds, handleToggleSelect, handleOpenEmailInTab, t],
  );

  const selectedEmailSourceId = effectiveSelectedEmailId ? `mail:${effectiveSelectedEmailId}` : null;
  const selectedEmailItem = useMemo(
    () => (effectiveSelectedEmailId ? scopedItems.find((item) => item.id === effectiveSelectedEmailId) ?? null : null),
    [effectiveSelectedEmailId, scopedItems],
  );
  const shouldShowFixturePreview = !isTauri()
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mailFixture') === '1';

  const activeFilterChips = [
    providerFilter ? providerDisplayLabel(providerFilter, t) : null,
    dateFrom ? `${t('mail.workspace.after')} ${dateFrom}` : null,
    dateTo ? `${t('mail.workspace.before')} ${dateTo}` : null,
    hasAttachments ? t('mail.workspace.attachments') : null,
  ].filter((chip): chip is string => chip !== null);
  const searchOrFilterActive = Boolean(query.trim()) || activeFilterChips.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  const railEmptyState = loading ? (
    <div data-testid="loading-state" className="flex items-center gap-2 px-1 py-3 text-sm text-[var(--color-muted-foreground)]">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      {t('mail.workspace.loading-email')}
    </div>
  ) : error ? (
    <div data-testid="error-state" className="flex flex-col gap-2 px-1 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium text-[var(--kp-warning)]">
        <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
        {t('mail.workspace.could-not-load')}
      </div>
      <p className="m-0 text-xs leading-snug text-[var(--color-muted-foreground)]">{error}</p>
      <Button variant="secondary" size="sm" data-testid="error-retry" onClick={handleRetry}>
        {t('mail.workspace.try-again')}
      </Button>
    </div>
  ) : mode === 'keyword' && hasConnectedMail ? (
    <div data-testid="no-results-state" className="px-1 py-3 text-sm text-[var(--color-muted-foreground)]">
      {query || activeFilterCount > 0 ? t('mail.workspace.no-results') : t('mail.workspace.no-emails')}
      {embedded && scopeMatches && items.length < total ? (
        <Button
          variant="secondary"
          size="sm"
          data-testid="email-scoped-load-more"
          onClick={handleLoadMore}
          disabled={loadingMore}
          {...(loadingMore ? { iconLeft: Loader2 } : {})}
          className="mt-2"
        >
          {loadingMore ? t('mail.workspace.looking') : t('mail.workspace.keep-looking')}
        </Button>
      ) : null}
    </div>
  ) : null;

  const renderFilterPanel = () => (
    <FilterPanel data-testid="filter-row" style={{ marginTop: 8, padding: 10 }}>
      <div className="grid gap-2">
        {uniqueProviders.length > 1 ? (
          <select
            data-testid="provider-filter"
            value={providerFilter}
            onChange={handleProviderChange}
            aria-label={t('mail.workspace.provider-filter-aria')}
            style={{ ...filterInputStyle, width: '100%' }}
          >
            <option value="">{t('mail.workspace.all-accounts')}</option>
            {uniqueProviders.map((p) => (
              <option key={p} value={p}>
                {providerDisplayLabel(p, t)}
              </option>
            ))}
          </select>
        ) : null}
        <fieldset className="grid gap-1 border-0 p-0">
          <legend className="text-[11px] font-medium text-[var(--color-muted-foreground)]">
            {t('mail.workspace.date-range')}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] font-medium text-[var(--color-muted-foreground)]">
              {t('mail.workspace.after')}
              <input
                type="date"
                data-testid="date-from"
                value={dateFrom}
                onChange={handleDateFromChange}
                aria-label={t('mail.workspace.from-date-aria')}
                style={{ ...filterInputStyle, width: '100%' }}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-medium text-[var(--color-muted-foreground)]">
              {t('mail.workspace.before')}
              <input
                type="date"
                data-testid="date-to"
                value={dateTo}
                onChange={handleDateToChange}
                aria-label={t('mail.workspace.to-date-aria')}
                style={{ ...filterInputStyle, width: '100%' }}
              />
            </label>
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)]">
          <input
            type="checkbox"
            data-testid="attachment-filter"
            checked={hasAttachments}
            onChange={handleAttachmentToggle}
            style={{ accentColor: 'var(--kp-navy)', cursor: 'pointer' }}
          />
          {t('mail.workspace.attachments')}
        </label>
      </div>
    </FilterPanel>
  );

  const emailMoreMenu = hasConnectedMail ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={MoreVertical}
          label={t('mail.workspace.more-actions')}
          size="sm"
          variant="ghost"
          data-testid="email-more-actions"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {(['keyword', 'ask'] as const).map((nextMode) => (
          <DropdownMenuItem
            key={nextMode}
            data-testid={`mode-${nextMode}`}
            onSelect={() => {
              setMode(nextMode);
              setQuery('');
              setOffset(0);
              setSelectedIds(new Set());
            }}
          >
            <Check
              className={`mr-2 h-3.5 w-3.5 ${mode === nextMode ? 'opacity-100' : 'opacity-0'}`}
              strokeWidth={2}
            />
            {nextMode === 'keyword' ? t('mail.workspace.keyword-search') : t('mail.workspace.ai-search')}
          </DropdownMenuItem>
        ))}
        {activeMatter && mode !== 'keyword' && !embedded ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="email-scope-matter"
              onSelect={() => {
                setScopeAllEmail(false);
                setOffset(0);
              }}
            >
              <Check
                className={`mr-2 h-3.5 w-3.5 ${!scopeAllEmail ? 'opacity-100' : 'opacity-0'}`}
                strokeWidth={2}
              />
              {t('mail.workspace.this-client')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="email-scope-all"
              onSelect={() => {
                setScopeAllEmail(true);
                setOffset(0);
              }}
            >
              <Check
                className={`mr-2 h-3.5 w-3.5 ${scopeAllEmail ? 'opacity-100' : 'opacity-0'}`}
                strokeWidth={2}
              />
              {t('mail.workspace.all-email')}
            </DropdownMenuItem>
          </>
        ) : null}
        {mode === 'keyword' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="filters-toggle"
              onSelect={() => { setFiltersVisible((v) => !v); }}
            >
              {filtersVisible ? t('mail.workspace.hide-filters') : t('mail.workspace.show-filters')}
              {activeFilterCount > 0 ? ` (${String(activeFilterCount)})` : ''}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="email-sync-now"
          disabled={syncing}
          onSelect={() => {
            if (syncing) return;
            handleSyncNow();
          }}
        >
          {syncing ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="mr-2 h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          {syncing
            ? syncImportedMessages != null
              ? t('mail.workspace.syncing-count', { count: syncImportedMessages })
              : t('mail.workspace.syncing')
            : t('mail.workspace.sync-now')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const railHeader = (
    <div className="shrink-0 border-b border-[var(--kp-divider)]">
      <RailShellHeader
        title={t('mail.workspace.title')}
        search={hasConnectedMail ? {
          value: query,
          onChange: (v) => {
            setQuery(v);
            setOffset(0);
            setSelectedIds(new Set());
          },
          onClear: handleClearQuery,
          placeholder: mode === 'keyword' ? t('mail.workspace.search-keyword-placeholder') : t('mail.workspace.search-ai-placeholder'),
          label: t('mail.workspace.search-aria'),
          testId: 'email-search-input',
          inputRef: searchInputRef,
        } : undefined}
        createAction={hasConnectedMail ? (
          <IconButton
            icon={Plus}
            label={t('mail.workspace.new-email')}
            size="sm"
            variant="ghost"
            data-testid="compose-btn"
            onClick={() => { setComposeOpen(true); }}
          />
        ) : null}
        menuAction={emailMoreMenu}
        collapseAction={(
          <IconButton
            icon={PanelLeftClose}
            label={t('mail.workspace.hide-list')}
            size="sm"
            variant="ghost"
            data-testid="email-rail-hide"
            onClick={() => { setRailCollapsed(true); }}
          />
        )}
        className="border-b-0"
      />
      {hasConnectedMail ? (
        <>
          {mode === 'ask' ? (
            <p className="m-0 px-3 pb-2 text-[11px] leading-snug text-[var(--color-muted-foreground)]">
              {t('mail.workspace.ask-hint')}
            </p>
          ) : null}
          {mode === 'keyword' && activeFilterChips.length > 0 ? (
            <div data-testid="active-filter-row" className="flex flex-wrap gap-1.5 px-3 pb-2">
              {activeFilterChips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-[var(--kp-divider)] bg-white px-2 py-0.5 text-[11px] text-[var(--color-muted-foreground)]"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
          {mode === 'keyword' && filtersVisible ? <div className="px-3 pb-2">{renderFilterPanel()}</div> : null}
          {mode === 'keyword' && !loading && !error && scopedItems.length > 0 && (searchOrFilterActive || (scopeMatches && items.length < total)) ? (
            <div data-testid="result-count" className="flex items-center justify-between gap-2 px-3 pb-2 text-[11px] text-[var(--color-muted-foreground)]">
              {searchOrFilterActive ? (
                <span>
                  {embedded
                    ? t('mail.workspace.showing-client', { count: scopedItems.length })
                    : t('mail.workspace.showing-count', { shown: items.length, total })}
                </span>
              ) : <span />}
              {scopeMatches && items.length < total ? (
                <button
                  type="button"
                  data-testid="load-more"
                  className="shrink-0 rounded border border-[var(--kp-divider)] bg-white px-2 py-1 text-[11px] font-medium text-[var(--kp-navy)] disabled:opacity-60"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? t('mail.workspace.loading-more') : t('mail.workspace.load-more')}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const renderAskContent = () => (
    <div className="h-full overflow-y-auto px-6 py-6">
      {askLoading ? (
        <div data-testid="ask-loading" className="flex items-center gap-2 py-4 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          {t('mail.workspace.searching-email')}
        </div>
      ) : null}

      {askError ? (
        <div data-testid="ask-error" className="flex items-center gap-2 py-4 text-sm text-[var(--kp-warning)]">
          <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
          {askError}
        </div>
      ) : null}

      {!askLoading && !askError && !query.trim() ? (
        <div data-testid="ask-empty-state" className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="text-base font-semibold leading-tight text-[var(--kp-navy)]">{t('mail.workspace.ask-your-email')}</div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {[
              t('mail.workspace.ask-chip-beneficiary'),
              t('mail.workspace.ask-chip-statements'),
            ].map((chip) => (
              <button
                key={chip}
                type="button"
                data-testid="ask-chip"
                onClick={() => { setQuery(chip); }}
                className="inline-flex items-center rounded-full border border-[rgba(10,37,64,0.14)] bg-[rgba(10,37,64,0.05)] px-3 py-1.5 text-left text-xs font-medium text-[var(--kp-navy)] hover:bg-[rgba(10,37,64,0.09)]"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!askLoading && !askError && askHits.length === 0 && query.trim() ? (
        <div data-testid="ask-no-results" className="py-6 text-center text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {!isMemoryEnabled() ? (
            <span>
              {t('mail.workspace.ask-memory-disabled-short')}{' '}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(EV_OPEN_SETTINGS, { detail: { category: 'ai' } }));
                }}
                className="font-semibold text-[var(--kp-navy)] underline"
              >
                {t('mail.workspace.enable-in-settings')}
              </button>
              .
            </span>
          ) : activeMatter && !scopeAllEmail && embedded ? (
            <span>{t('mail.workspace.ask-no-client-email-embedded')}</span>
          ) : activeMatter && !scopeAllEmail ? (
            <span>
              {t('mail.workspace.ask-no-client-email')}{' '}
              <button
                type="button"
                data-testid="ask-no-results-switch-scope"
                onClick={() => { setScopeAllEmail(true); }}
                className="font-semibold text-[var(--kp-navy)] underline"
              >
                {t('mail.workspace.switch-to-all-email')}
              </button>
              {' '}{t('mail.workspace.ask-no-client-email-suffix')}
            </span>
          ) : (
            t('mail.workspace.ask-no-matches')
          )}
        </div>
      ) : null}

      {!askLoading && !askError && askHits.map((hit, i) => (
        <AskHitCard key={hit.sourceId ?? hit.path} hit={hit} rank={i + 1} items={items} />
      ))}
    </div>
  );

  return (
    <div
      data-testid="email-workspace"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background)] font-sans"
    >
      <div data-testid="mail-list-scroll" className="flex min-h-0 flex-1">
        <RailShell
          className="min-h-0 flex-1"
          collapsed={railCollapsed}
          collapsedRail={(
            <div className="flex flex-col items-center gap-2">
              <IconButton
                icon={PanelLeftOpen}
                label={t('mail.workspace.show-list')}
                size="sm"
                variant="ghost"
                data-testid="email-rail-show"
                onClick={() => { setRailCollapsed(false); }}
              />
              {hasConnectedMail ? (
                <IconButton
                  icon={Plus}
                  label={t('mail.workspace.new-email')}
                  size="sm"
                  variant="ghost"
                  data-testid="compose-btn"
                  onClick={() => { setComposeOpen(true); }}
                />
              ) : null}
            </div>
          )}
          header={railHeader}
          listAriaLabel={t('mail.workspace.rail-list-label')}
          items={mode === 'keyword' ? railItems : []}
          activeId={mode === 'keyword' ? effectiveSelectedEmailId : null}
          onSelect={setSelectedEmailId}
          emptyState={railEmptyState}
          virtualization={{
            enabled: mode === 'keyword' && railItems.length > EMAIL_RAIL_VIRTUALIZE_ROW_THRESHOLD,
            estimateSize: EMAIL_RAIL_ROW_ESTIMATED_HEIGHT_PX,
            overscan: 8,
          }}
        >
          <div data-testid="email-master-detail" className="flex h-full min-h-0 min-w-0 flex-col">
            <div data-testid="email-detail-pane" className="flex min-h-0 flex-1 flex-col bg-white">
              <div data-testid="email-body" className="flex min-h-0 flex-1 flex-col">
            {hasConnectedMail && !firstConnectCalloutSeen ? (
              <div className="shrink-0 px-6 pt-4">
                <div data-testid="first-connect-callout">
                  <Callout
                    variant="info"
                    icon={Sparkles}
                    onDismiss={dismissFirstConnectCallout}
                  >
                    <button
                      type="button"
                      data-testid="first-connect-callout-cta"
                      onClick={() => {
                        dismissFirstConnectCallout();
                        searchInputRef.current?.focus();
                      }}
                      className="text-left font-semibold text-[var(--kp-navy)] underline"
                    >
                      {t('mail.workspace.first-connect-callout')}
                    </button>
                  </Callout>
                </div>
              </div>
            ) : null}

            {syncStalled ? (
              <div data-testid="email-sync-stalled" className="shrink-0 px-6 pt-4">
                <Callout variant="warning" icon={AlertTriangle}>
                  {t('mail.workspace.sync-stalled')}
                </Callout>
              </div>
            ) : null}
            {syncError ? (
              <div data-testid="email-sync-error" className="shrink-0 px-6 pt-4">
                <Callout variant="error" icon={AlertTriangle}>
                  {syncError}
                </Callout>
              </div>
            ) : null}

            {composeHandoffMessage ? (
              <div data-testid="email-compose-handoff-message" className="shrink-0 px-6 pt-4">
                <Callout variant="info" icon={Mail}>{composeHandoffMessage}</Callout>
              </div>
            ) : null}

            {selectedIds.size > 0 ? (
              <BulkActionBar
                selectedCount={selectedIds.size}
                selectedIds={selectedIds}
                onClearSelection={handleClearSelection}
                bulkMatterOpen={bulkMatterOpen}
                onBulkMatterOpenChange={setBulkMatterOpen}
              />
            ) : null}

            {accountsLoaded && accounts.length === 0 ? (
              <NoAccountsState onOpenSettings={onOpenSettings} />
            ) : null}

            {hasConnectedMail && mode === 'keyword' && !loading && !error && scopedItems.length > 0 && selectedEmailSourceId ? (
              shouldShowFixturePreview && selectedEmailItem ? (
                <EmailFixturePreview
                  item={selectedEmailItem}
                  subjectLabel={selectedEmailItem.subject || t('mail.workspace.no-subject')}
                  previewLabel={t('mail.workspace.demo-preview')}
                  previewNote={t('mail.workspace.demo-preview-note')}
                />
              ) : (
                <EmailViewer
                  sourceId={selectedEmailSourceId}
                  onOpenSettings={onOpenSettings}
                  onSaveToWorkspace={onSaveToWorkspace}
                  className="min-h-0 flex-1"
                />
              )
            ) : null}

            {hasConnectedMail && mode === 'keyword' && !loading && !error && scopedItems.length === 0 ? (
              <div
                data-testid="email-detail-empty-state"
                className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
              >
                <Mail className="h-7 w-7 text-[var(--color-muted-foreground)]" strokeWidth={1.5} />
                <p className="m-0 text-sm font-medium text-[var(--color-foreground)]">
                  {t('mail.workspace.no-emails')}
                </p>
                <p className="m-0 max-w-sm text-xs leading-snug text-[var(--color-muted-foreground)]">
                  {query
                    ? t('mail.workspace.no-emails-query')
                    : embedded
                      ? t('mail.workspace.no-emails-client')
                      : t('mail.workspace.no-emails-synced')}
                </p>
              </div>
            ) : null}

            {hasConnectedMail && mode === 'keyword' && (loading || error) ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-muted-foreground)]">
                {loading ? t('mail.workspace.loading-email') : t('mail.workspace.select-email-after-error')}
              </div>
            ) : null}

            {accountsLoaded && accounts.length > 0 && mode === 'ask' ? renderAskContent() : null}
              </div>
            </div>
          </div>
        </RailShell>
      </div>

      <ComposeModal
        open={composeOpen}
        onOpenChange={handleComposeOpenChange}
        accounts={accounts}
        onOpenSettings={onOpenSettings}
        {...(composeHouseholdContext ? { householdContextLabel: composeHouseholdContext } : {})}
      />
    </div>
  );
}
