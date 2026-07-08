/**
 * AuditHome — full-page AI Audit surface.
 *
 * A native full-page surface matching the Matters / Email workspace pattern:
 * eyebrow + title header, controls row (search, filters, export), a clean
 * scannable table of audit entries (newest first), row-click detail panel,
 * and an empty state. Light theme; Satoshi; CSS vars; inline styles throughout.
 *
 * Prop contract (unchanged): entries: AuditEntry[]
 *
 * Design notes:
 * - Virtualization: renders up to PAGE_SIZE rows; "Load more" appends the
 *   next page. Keeps the DOM small for large logs without a heavy library.
 * - Action categories: file ops (green), AI/egress (violet), workflow
 *   (purple), privilege/firm (indigo), system (slate).
 * - Scope color: local = green pill, direct = blue pill, assured = indigo pill.
 */

import {
  useState,
  useMemo,
  useCallback,
  useDeferredValue,
  useEffect,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Download,
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import {
  filterEntries,
  uniqueModels,
  uniqueMatterScopes,
  downloadAuditCSV,
  downloadAuditJSON,
} from '@/features/audit/audit-export';
import { isAuditEncrypted } from '@/platform/audit/AuditService';
import { useEntityLabelEnglish } from '@/platform/hooks/useEntityLabel';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import {
  Button,
  SearchField,
  FilterToggle,
  Card,
  SurfaceToolbar,
} from '@/ui/kp';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import {
  PAGE_SIZE,
  ActionCategory,
  ACTION_CATEGORY,
} from './auditHomeHelpers';
import {
  CategoryFilter,
  DetailPanel,
  AuditRow,
  TableHeader,
  AuditEmptyState,
  AuditNoMatchState,
  AuditFilterPanel,
} from './auditHomeViews';

// ── Props ──────────────────────────────────────────────────────────────────

export interface AuditHomeProps {
  entries: AuditEntry[];
  integrity?: AuditIntegrityVerdict | undefined;
  onVerifyIntegrity?: (() => Promise<AuditIntegrityVerdict | undefined>) | undefined;
  /**
   * Explicit, acknowledged repair of a seal-missing audit log. When set and the
   * integrity state is `sealMissing`, the badge area shows a Repair action that
   * (after a plain-language confirmation) calls this to re-seal the chain and
   * permanently record the anomaly, then refresh the entries + integrity state.
   */
  onRepairSeal?: (() => Promise<void>) | undefined;
  /**
   * When set, the log is pre-scoped to a single client's activity (used by the
   * per-client Activity sub-tab in the Client Map hub). Entries are filtered to
   * those whose matter scope matches this id before any in-view filtering, so
   * the Activity tab reads as "this client's activity", not the global log.
   */
  scopeMatterId?: string;
}

// ── Main component ─────────────────────────────────────────────────────────

export function AuditHome({ entries: entriesProp, integrity, onVerifyIntegrity, onRepairSeal, scopeMatterId }: AuditHomeProps) {
  // Embedded as a per-client Activity tab (scopeMatterId set) → the hub header
  // already labels the surface, so hide this inner header to match Documents.
  const embedded = scopeMatterId !== undefined;
  const { t } = useTranslation();
  // Profession-aware entity word so the export note follows the practice
  // (advisor → "clients", legal → "matters") instead of a hardcoded "matters".
  // Fixed-English escape hatch: the export note below is still a hardcoded
  // English sentence (see the cleanup2 handoff), so the noun stays English
  // too rather than mixing a translated word into it.
  const entityLabel = useEntityLabelEnglish();
  // ── Filter state ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditActionType>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [matterIdFilter, setMatterIdFilter] = useState('');

  // ── Pagination ────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Detail panel ──────────────────────────────────────────────────────
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);

  // Pre-scope to a single client when embedded as the per-client Activity
  // sub-tab. Reuses the same matter-scope matching the in-view filter uses, so
  // every downstream derivation (models, scopes, counts, export) operates on
  // this client's activity only. Unscoped (scopeMatterId absent) = global log.
  const entries = useMemo(
    () => (scopeMatterId ? filterEntries(entriesProp, { matterId: scopeMatterId }) : entriesProp),
    [entriesProp, scopeMatterId],
  );

  // ── Derived data ──────────────────────────────────────────────────────
  const availableModels = useMemo(() => uniqueModels(entries), [entries]);
  const availableMatterScopes = useMemo(() => uniqueMatterScopes(entries), [entries]);

  // Build effective action-type set: merge category filter + explicit type chips
  const effectiveTypes = useMemo<Set<AuditActionType>>(() => {
    if (selectedTypes.size > 0) return selectedTypes;
    if (categoryFilter === 'all') return new Set<AuditActionType>();
    const inCategory = (Object.entries(ACTION_CATEGORY) as [AuditActionType, ActionCategory][])
      .filter(([, cat]) => cat === categoryFilter)
      .map(([type]) => type);
    return new Set<AuditActionType>(inCategory);
  }, [categoryFilter, selectedTypes]);

  // Defer the search/filter inputs so that typing stays responsive when the
  // entries array is large. The deferred value lags one frame behind user
  // input, keeping keystrokes instant while the memo catches up.
  const deferredSearch = useDeferredValue(searchQuery);
  const deferredDateFrom = useDeferredValue(dateFrom);
  const deferredDateTo = useDeferredValue(dateTo);
  const deferredModelFilter = useDeferredValue(modelFilter);
  const deferredEffectiveTypes = useDeferredValue(effectiveTypes);

  const filteredEntries = useMemo(() => {
    const result = filterEntries(entries, {
      actionTypes: deferredEffectiveTypes,
      dateFrom: deferredDateFrom || undefined,
      dateTo: deferredDateTo || undefined,
      model: deferredModelFilter || undefined,
      matterId: matterIdFilter || undefined,
      searchQuery: deferredSearch || undefined,
    });
    // NOTE: If the entries prop is guaranteed newest-first from the source,
    // this sort could be dropped. For now we sort defensively since the source
    // order is not documented as a stable guarantee.
    return result.slice().sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [entries, deferredEffectiveTypes, deferredDateFrom, deferredDateTo, deferredModelFilter, matterIdFilter, deferredSearch]);

  const exportScopeLabel = useMemo(() => {
    if (!matterIdFilter) return `Exporting all ${entityLabel.other}.`;
    const selected = availableMatterScopes.find((scope) => scope.matterId === matterIdFilter);
    return `Exporting ${selected?.label ?? matterIdFilter} only.`;
  }, [availableMatterScopes, matterIdFilter, entityLabel.other]);

  const visibleEntries = filteredEntries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredEntries.length;

  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) +
    selectedTypes.size +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (modelFilter ? 1 : 0) +
    (matterIdFilter ? 1 : 0);

  const handleReset = useCallback(() => {
    setCategoryFilter('all');
    setSelectedTypes(new Set());
    setDateFrom('');
    setDateTo('');
    setModelFilter('');
    setMatterIdFilter('');
    setVisibleCount(PAGE_SIZE);
  }, []);

  // Resets all filters AND the search query — used by the no-match state CTA.
  const handleClearAll = useCallback(() => {
    setSearchQuery('');
    setCategoryFilter('all');
    setSelectedTypes(new Set());
    setDateFrom('');
    setDateTo('');
    setModelFilter('');
    setMatterIdFilter('');
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleToggleType = useCallback((type: AuditActionType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleCategoryChange = useCallback((c: CategoryFilter) => {
    setCategoryFilter(c);
    setSelectedTypes(new Set());
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleDateFromChange = useCallback((v: string) => {
    setDateFrom(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleDateToChange = useCallback((v: string) => {
    setDateTo(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleModelChange = useCallback((v: string) => {
    setModelFilter(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleMatterChange = useCallback((v: string) => {
    setMatterIdFilter(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleSearchChange = useCallback((v: string) => {
    setSearchQuery(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const resolveIntegrityForExport = useCallback(async () => {
    if (!onVerifyIntegrity) return integrity;
    try {
      return await onVerifyIntegrity();
    } catch {
      return integrity;
    }
  }, [integrity, onVerifyIntegrity]);

  const handleExportCSV = useCallback(() => {
    void (async () => {
      const verdict = await resolveIntegrityForExport();
      downloadAuditCSV(filteredEntries, new Date(), verdict);
    })();
  }, [filteredEntries, resolveIntegrityForExport]);

  const handleExportJSON = useCallback(() => {
    void (async () => {
      const verdict = await resolveIntegrityForExport();
      downloadAuditJSON(filteredEntries, new Date(), verdict);
    })();
  }, [filteredEntries, resolveIntegrityForExport]);

  const encrypted = isAuditEncrypted();
  // Three honest tones: green (verified), amber (seal missing — can't prove the
  // log is complete), red (altered — a row was actually changed/broken).
  let integrityLabel: string | null = null;
  let integrityTone: 'ok' | 'warning' | 'danger' = 'ok';
  let integrityTitle: string | undefined;
  if (integrity?.status === 'altered') {
    integrityLabel = t('common.audit-log.integrity-altered', { seq: integrity.seq });
    integrityTone = 'danger';
    integrityTitle = integrity.reason;
  } else if (integrity?.status === 'sealMissing') {
    integrityLabel = t('common.audit-log.integrity-seal-missing');
    integrityTone = 'warning';
    integrityTitle = integrity.lastTimestamp
      ? t('common.audit-log.integrity-seal-missing-detail', { timestamp: integrity.lastTimestamp })
      : t('common.audit-log.integrity-seal-missing-detail-notime');
  } else if (integrity?.status === 'verified') {
    integrityLabel = t('common.audit-log.integrity-verified');
    integrityTone = 'ok';
  }
  const integrityToneStyle = {
    ok: { border: '1px solid rgba(21,128,61,0.28)', background: 'rgba(240,253,244,0.9)', color: '#166534' },
    warning: { border: '1px solid rgba(180,83,9,0.32)', background: 'rgba(255,251,235,0.95)', color: '#92400e' },
    danger: { border: '1px solid rgba(185,28,28,0.28)', background: 'rgba(254,242,242,0.9)', color: '#991b1b' },
  }[integrityTone];

  // Explicit, acknowledged repair — the ONLY user action that can re-seal a
  // seal-missing chain, gated behind a plain-language confirmation that states
  // what can no longer be verified and that the anomaly is recorded for good.
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const canRepair = integrity?.status === 'sealMissing' && !!onRepairSeal && !embedded;
  const handleRepair = useCallback(async () => {
    if (!onRepairSeal) return;
    const ok = await confirm(t('common.audit-log.repair-confirm-body'), {
      title: t('common.audit-log.repair-confirm-title'),
      confirmLabel: t('common.audit-log.repair-confirm-cta'),
      variant: 'destructive',
    });
    if (!ok) return;
    setRepairError(null);
    setRepairing(true);
    try {
      await onRepairSeal();
    } catch (err) {
      // A failed repair in a security-critical recovery flow must never look
      // like a no-op: surface it plainly so the user knows the log is unchanged
      // and still needs repair, and can retry.
      console.error('[Audit] Seal repair failed:', err);
      setRepairError(t('common.audit-log.repair-failed'));
    } finally {
      setRepairing(false);
    }
  }, [confirm, onRepairSeal, t]);

  // Clear any stale repair error whenever the integrity verdict changes — a
  // re-verify, a successful repair, or switching to a different workspace's log
  // all produce a fresh verdict object. This stops a "Repair failed" message
  // from a previous attempt/log leaking onto an unrelated seal-missing state.
  useEffect(() => {
    setRepairError(null);
  }, [integrity]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minWidth: 0,
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header — hidden when embedded as a per-client tab (the hub header
          covers it). No subtitle on any tab header. */}
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      {!embedded && (
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={ShieldCheck}
          title="Activity Log"
        />
        {integrityLabel !== null && (
          <span
            data-testid="audit-integrity-badge"
            data-integrity-status={integrity?.status}
            title={integrityTitle}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              marginTop: 10,
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              border: integrityToneStyle.border,
              background: integrityToneStyle.background,
              color: integrityToneStyle.color,
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-semibold)',
              lineHeight: 'var(--kp-leading-snug)',
              whiteSpace: 'nowrap',
            }}
          >
            {integrityLabel}
          </span>
        )}
        {canRepair && (
          <Button
            variant="secondary"
            size="sm"
            data-testid="audit-repair-button"
            onClick={() => void handleRepair()}
            loading={repairing}
            disabled={repairing}
            style={{ marginTop: 10, marginLeft: 8, verticalAlign: 'middle' }}
          >
            {t('common.audit-log.repair-action')}
          </Button>
        )}
        {canRepair && repairError && (
          <div
            data-testid="audit-repair-error"
            role="alert"
            style={{
              marginTop: 8,
              color: '#991b1b',
              fontSize: 'var(--kp-font-xs)',
              lineHeight: 'var(--kp-leading-snug)',
            }}
          >
            {repairError}
          </div>
        )}
      </div>
      )}
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Toolbar */}
      <SurfaceToolbar>
        <SearchField
          size="md"
          style={{ flex: 1, minWidth: 240 }}
          value={searchQuery}
          onChange={handleSearchChange}
          onClear={() => { handleSearchChange(''); }}
          placeholder="Search by action, resource, or actor..."
          data-testid="audit-home-search"
          aria-label="Search audit entries"
        />
        <FilterToggle
          open={showFilters}
          onToggle={() => { setShowFilters((v) => !v); }}
          count={activeFilterCount}
          data-testid="audit-home-filter-toggle"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={Download}
              data-testid="audit-home-export-menu"
              disabled={filteredEntries.length === 0}
              title={filteredEntries.length === 0 ? 'No activity to export yet' : 'Export activity'}
              aria-label="Export audit log"
            >
              {/* eslint-disable lantern-i18n/no-hardcoded-string */}
              Export
              {/* eslint-enable lantern-i18n/no-hardcoded-string */}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              data-testid="audit-home-export-csv"
              className="gap-2"
              onSelect={() => { handleExportCSV(); }}
            >
              <Download className="h-4 w-4" aria-hidden />
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="audit-home-export-json"
              className="gap-2"
              onSelect={() => { handleExportJSON(); }}
            >
              <Download className="h-4 w-4" aria-hidden />
              JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SurfaceToolbar>

      {/* Content — filter panel, result-count note, table */}

      {/* Browser-mode note — shown only when not running in the desktop app */}
      {!encrypted && (
        <div
          style={{
            padding: 'var(--kp-space-xs) var(--kp-gutter)',
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--color-muted-foreground)',
            background: 'rgba(100,116,139,0.05)',
            borderBottom: '1px solid var(--kp-divider)',
            flexShrink: 0,
          }}
        >
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          Stored in your browser, not encrypted. Use the desktop app for confidential work.
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        </div>
      )}

      {/* Filter panel (expanded) — full-width below toolbar */}
      {showFilters && (
        <AuditFilterPanel
          categoryFilter={categoryFilter}
          onCategoryChange={handleCategoryChange}
          selectedTypes={selectedTypes}
          onToggleType={handleToggleType}
          dateFrom={dateFrom}
          onDateFromChange={handleDateFromChange}
          dateTo={dateTo}
          onDateToChange={handleDateToChange}
          availableModels={availableModels}
          modelFilter={modelFilter}
          onModelChange={handleModelChange}
          availableMatterScopes={availableMatterScopes}
          matterIdFilter={matterIdFilter}
          onMatterChange={handleMatterChange}
          activeFilterCount={activeFilterCount}
          onReset={handleReset}
        />
      )}

      {/* Result count + export filter note */}
      {(entries.length > 0 || searchQuery || activeFilterCount > 0 || (filteredEntries.length > 0 && filteredEntries.length < entries.length)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '4px var(--kp-gutter)',
            borderBottom: '1px solid var(--kp-divider)',
            flexShrink: 0,
          }}
        >
          {(searchQuery || activeFilterCount > 0) && (
            <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>
              {String(filteredEntries.length)} of {String(entries.length)} shown
            </span>
          )}
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}
          {filteredEntries.length > 0 && (
            <span
              data-testid="audit-export-scope-note"
              style={{
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                lineHeight: 'var(--kp-leading-normal)',
                whiteSpace: 'nowrap',
              }}
            >
              {exportScopeLabel}
            </span>
          )}
          {filteredEntries.length > 0 && filteredEntries.length < entries.length && (
            <span
              data-testid="audit-export-filter-note"
              style={{
                fontSize: 'var(--kp-font-2xs)',
                color: 'var(--color-muted-foreground)',
                lineHeight: 'var(--kp-leading-normal)',
              }}
            >
              Exporting {String(filteredEntries.length)} filtered {filteredEntries.length === 1 ? 'entry' : 'entries'}.{' '}
              <button
                type="button"
                data-testid="audit-export-clear-filters"
                onClick={handleClearAll}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 'inherit',
                  color: 'var(--kp-navy)',
                  fontWeight: 'var(--kp-weight-semibold)',
                  textDecoration: 'underline',
                  textDecorationStyle: 'dotted',
                }}
              >
                Clear filters to export all {String(entries.length)}.
              </button>
            </span>
          )}
          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {/* Table card */}
        <Card
          variant="flat"
          style={{
            margin: 'var(--kp-surface-gap) var(--kp-gutter) var(--kp-gutter)',
            overflow: 'hidden',
          }}
        >
          {filteredEntries.length === 0 && entries.length === 0 ? (
            <AuditEmptyState />
          ) : filteredEntries.length === 0 ? (
            <AuditNoMatchState onClearFilters={handleClearAll} />
          ) : (
            <>
              <TableHeader />
              <div data-testid="audit-table-body">
                {visibleEntries.map((entry) => (
                  <AuditRow
                    key={entry.id}
                    entry={entry}
                    onSelect={setDetailEntry}
                  />
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '14px 20px',
                    borderTop: '1px solid var(--kp-divider)',
                  }}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="audit-load-more"
                    onClick={() => { setVisibleCount((v) => v + PAGE_SIZE); }}
                  >
                    {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                    Load {String(Math.min(PAGE_SIZE, filteredEntries.length - visibleCount))} more
                    {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                  </Button>
                  <span style={{ marginLeft: 12, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                    {/* eslint-disable lantern-i18n/no-hardcoded-string */}
                    showing {String(visibleEntries.length)} of {String(filteredEntries.length)}
                    {/* eslint-enable lantern-i18n/no-hardcoded-string */}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Detail panel */}
      {detailEntry !== null && (
        <DetailPanel
          entry={detailEntry}
          onClose={() => { setDetailEntry(null); }}
        />
      )}
    </div>
  );
}
