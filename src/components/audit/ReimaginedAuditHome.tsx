/**
 * ReimaginedAuditHome — full-page AI Audit surface.
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
} from 'react';
import {
  ShieldCheck,
  Download,
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/types/audit';
import {
  filterEntries,
  uniqueModels,
  downloadAuditCSV,
  downloadAuditJSON,
} from '@/utils/audit-export';
import { isAuditEncrypted } from '@/modules/audit/AuditService';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';
import {
  Button,
  SearchField,
  FilterToggle,
  Card,
  SurfaceToolbar,
} from '@/components/ui/kp';
import {
  PAGE_SIZE,
  ActionCategory,
  ACTION_CATEGORY,
} from './reimaginedAuditHomeHelpers';
import {
  CategoryFilter,
  DetailPanel,
  AuditRow,
  TableHeader,
  AuditEmptyState,
  AuditNoMatchState,
  AuditFilterPanel,
} from './reimaginedAuditHomeViews';

// ── Props ──────────────────────────────────────────────────────────────────

export interface ReimaginedAuditHomeProps {
  entries: AuditEntry[];
}

// ── Main component ─────────────────────────────────────────────────────────

export function ReimaginedAuditHome({ entries }: ReimaginedAuditHomeProps) {
  // ── Filter state ──────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditActionType>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modelFilter, setModelFilter] = useState('');

  // ── Pagination ────────────────────────────────────────────────────────
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // ── Detail panel ──────────────────────────────────────────────────────
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);

  // ── Derived data ──────────────────────────────────────────────────────
  const availableModels = useMemo(() => uniqueModels(entries), [entries]);

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
      searchQuery: deferredSearch || undefined,
    });
    // NOTE: If the entries prop is guaranteed newest-first from the source,
    // this sort could be dropped. For now we sort defensively since the source
    // order is not documented as a stable guarantee.
    return result.slice().sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [entries, deferredEffectiveTypes, deferredDateFrom, deferredDateTo, deferredModelFilter, deferredSearch]);

  const visibleEntries = filteredEntries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredEntries.length;

  const activeFilterCount =
    (categoryFilter !== 'all' ? 1 : 0) +
    selectedTypes.size +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (modelFilter ? 1 : 0);

  const handleReset = useCallback(() => {
    setCategoryFilter('all');
    setSelectedTypes(new Set());
    setDateFrom('');
    setDateTo('');
    setModelFilter('');
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

  const handleSearchChange = useCallback((v: string) => {
    setSearchQuery(v);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const handleExportCSV = useCallback(() => {
    downloadAuditCSV(filteredEntries);
  }, [filteredEntries]);

  const handleExportJSON = useCallback(() => {
    downloadAuditJSON(filteredEntries);
  }, [filteredEntries]);

  const encrypted = isAuditEncrypted();


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
      {/* Header */}
      {/* eslint-disable keepance-i18n/no-hardcoded-string */}
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={ShieldCheck}
          title="Activity Log"
          description="Every AI request, file change, and workflow run in your workspace, logged and exportable."
        />
      </div>
      {/* eslint-enable keepance-i18n/no-hardcoded-string */}

      {/* Toolbar */}
      <SurfaceToolbar>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Download}
          data-testid="audit-home-export-csv"
          onClick={handleExportCSV}
          disabled={filteredEntries.length === 0}
          title={filteredEntries.length === 0 ? 'No activity to export yet' : 'Export as CSV'}
          aria-label="Export audit log as CSV"
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          CSV
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={Download}
          data-testid="audit-home-export-json"
          onClick={handleExportJSON}
          disabled={filteredEntries.length === 0}
          title={filteredEntries.length === 0 ? 'No activity to export yet' : 'Export as JSON'}
          aria-label="Export audit log as JSON"
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          JSON
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </Button>
        <FilterToggle
          open={showFilters}
          onToggle={() => { setShowFilters((v) => !v); }}
          count={activeFilterCount}
          data-testid="audit-home-filter-toggle"
        />
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
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          Stored in your browser, not encrypted. Use the desktop app for confidential work.
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
          activeFilterCount={activeFilterCount}
          onReset={handleReset}
        />
      )}

      {/* Result count + export filter note */}
      {(searchQuery || activeFilterCount > 0 || (filteredEntries.length > 0 && filteredEntries.length < entries.length)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '4px var(--kp-gutter)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          {(searchQuery || activeFilterCount > 0) && (
            <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', whiteSpace: 'nowrap' }}>
              {String(filteredEntries.length)} of {String(entries.length)} shown
            </span>
          )}
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
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
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
                    borderTop: '1px solid var(--color-border)',
                  }}
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="audit-load-more"
                    onClick={() => { setVisibleCount((v) => v + PAGE_SIZE); }}
                  >
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    Load {String(Math.min(PAGE_SIZE, filteredEntries.length - visibleCount))} more
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
                  </Button>
                  <span style={{ marginLeft: 12, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                    {/* eslint-disable keepance-i18n/no-hardcoded-string */}
                    showing {String(visibleEntries.length)} of {String(filteredEntries.length)}
                    {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
