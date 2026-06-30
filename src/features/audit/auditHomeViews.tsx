/**
 * auditHomeViews.tsx
 * Self-contained presentational sub-components extracted from
 * AuditHome.tsx. Each component takes a clean props interface
 * and does not close over the parent component's state or handlers.
 */

import React, { useState } from 'react';
import {
  ShieldCheck,
  Search,
  X,
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/platform/types/audit';
import { asRecord, type AuditMatterScopeOption } from '@/features/audit/audit-export';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import {
  Button,
  FilterPanel,
  Badge,
  Chip,
  Eyebrow,
  EmptyState,
  SlidePanel,
} from '@/ui/kp';
import {
  lookupLabel,
  lookupCategory,
  toSafeString,
  renderActionIcon,
  ACTION_ICONS,
  ACTION_LABELS,
  ActionCategory,
  ACTION_CATEGORY,
  CATEGORY_COLOR,
  CATEGORY_BG,
  CATEGORY_LABEL,
  formatTimestamp,
  formatFullTimestamp,
  getScopeLabel,
} from './auditHomeHelpers';

// ── Model display helper ────────────────────────────────────────────────────

/**
 * Map internal/dev model identifiers to user-friendly display strings.
 * Only changes the label shown in the UI — stored data is never modified.
 */
function displayModelLabel(model: string): string {
  if (model === 'mock-model' || model === 'mock_model') return 'No AI configured';
  return model;
}

// ── Detail panel ───────────────────────────────────────────────────────────

export interface DetailPanelProps {
  entry: AuditEntry;
  onClose: () => void;
}

export function DetailPanel({ entry, onClose }: DetailPanelProps) {
  const entityLabel = useEntityLabel();
  const category = lookupCategory(ACTION_CATEGORY, entry.action);
  const iconColor = CATEGORY_COLOR[category];
  const scopeLabel = getScopeLabel(entry);
  // Defensive: a row may arrive without these objects (e.g. connector entries).
  const inputs = asRecord(entry.inputs);
  const outputs = asRecord(entry.outputs);
  const metadata = asRecord(entry.metadata);
  const hasInputs = Object.keys(inputs).length > 0;
  const hasOutputs = Object.keys(outputs).length > 0;
  const hasMetadata = Object.keys(metadata).length > 0;

  return (
    <SlidePanel
      open
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {renderActionIcon(ACTION_ICONS, entry.action, { width: 'var(--kp-icon-lg)', height: 'var(--kp-icon-lg)', color: iconColor, strokeWidth: 1.75 })}
          <div>
            <Eyebrow style={{ marginBottom: 2 }}>Entry detail</Eyebrow>
            <div style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', lineHeight: 'var(--kp-leading-tight)' }}>
              {lookupLabel(ACTION_LABELS, entry.action)}
            </div>
          </div>
        </div>
      }
      width={420}
      closeLabel="Close detail panel"
      data-testid="audit-detail-panel"
    >
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Description */}
        <div>
          <div style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 6 }}>
            Description
          </div>
          <div style={{ fontSize: 'var(--kp-font-md)', color: 'var(--kp-navy)', lineHeight: 'var(--kp-leading-normal)' }}>
            {entry.description}
          </div>
        </div>

        {/* Meta grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
          <MetaField label="Timestamp" value={formatFullTimestamp(entry.timestamp)} mono />
          <MetaField label="ID" value={entry.id} mono truncate />
          <MetaField label="Action" value={entry.action} mono />
          {entry.model !== undefined && <MetaField label="Model" value={displayModelLabel(entry.model)} />}
          {entry.userDecision !== undefined && (
            <MetaField label="User decision" value={entry.userDecision} />
          )}
          {scopeLabel !== null && <MetaField label="Scope" value={scopeLabel} />}
          {entry.tokensIn !== undefined && (
            <MetaField label="Tokens in" value={String(entry.tokensIn)} mono />
          )}
          {entry.tokensOut !== undefined && (
            <MetaField label="Tokens out" value={String(entry.tokensOut)} mono />
          )}
          {entry.costUsd !== undefined && (
            <MetaField label="Cost (USD)" value={`$${entry.costUsd.toFixed(6)}`} mono />
          )}
          {entry.provider !== undefined && <MetaField label="Provider" value={entry.provider} />}
        </div>

        {/* Firm governance fields */}
        {(() => {
          const fmid = metadata['firm_matter_id'];
          const mid = metadata['matter_id'];
          const tuid = metadata['target_user_id'];
          const oid = metadata['org_id'];
          if (fmid == null && mid == null && tuid == null) return null;
          const sfmid = toSafeString(fmid);
          const smid = toSafeString(mid);
          const stuid = toSafeString(tuid);
          const soid = toSafeString(oid);
          return (
            <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sfmid && <GovRow label={`Firm ${entityLabel.one}`} value={sfmid} />}
              {smid && smid !== sfmid && <GovRow label={`Local ${entityLabel.one}`} value={smid} />}
              {stuid && <GovRow label="Target user" value={stuid} />}
              {soid && <GovRow label="Org" value={soid} />}
            </div>
          );
        })()}

        {/* Inputs */}
        {hasInputs && (
          <JsonBlock label="Inputs" value={inputs} />
        )}

        {/* Outputs */}
        {hasOutputs && (
          <JsonBlock label="Outputs" value={outputs} />
        )}

        {/* Metadata */}
        {hasMetadata && (
          <JsonBlock label="Metadata" value={metadata} />
        )}
      </div>
    </SlidePanel>
  );
}

export interface MetaFieldProps {
  label: string;
  value: string | undefined;
  mono?: boolean;
  truncate?: boolean;
}

export function MetaField({ label, value, mono = false, truncate = false }: MetaFieldProps) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 3 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 'var(--kp-font-xs)',
          color: 'var(--kp-navy)',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined,
          wordBreak: truncate ? 'break-all' : undefined,
          overflow: truncate ? 'hidden' : undefined,
          textOverflow: truncate ? 'ellipsis' : undefined,
          whiteSpace: truncate ? 'nowrap' : undefined,
        }}
        title={truncate ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

export interface GovRowProps { label: string; value: string }
export function GovRow({ label, value }: GovRowProps) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', width: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--kp-font-2xs)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--kp-navy)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

export interface JsonBlockProps { label: string; value: Record<string, unknown> }
export function JsonBlock({ label, value }: JsonBlockProps) {
  return (
    <div>
      <div style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-muted-foreground)', marginBottom: 6 }}>
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(10,37,64,0.03)',
          border: '1px solid var(--color-border)',
          fontSize: 'var(--kp-font-2xs)',
          lineHeight: 'var(--kp-leading-snug)',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          color: '#334155',
          overflowX: 'auto',
          maxHeight: 200,
          overflowY: 'auto',
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

// ── Table row ──────────────────────────────────────────────────────────────

export interface AuditRowProps {
  entry: AuditEntry;
  onSelect: (entry: AuditEntry) => void;
}

export function AuditRow({ entry, onSelect }: AuditRowProps) {
  const [hovered, setHovered] = useState(false);
  const category = lookupCategory(ACTION_CATEGORY, entry.action);
  const iconColor = CATEGORY_COLOR[category];
  const iconBg = CATEGORY_BG[category];
  const scopeLabel = getScopeLabel(entry);

  return (
    <button
      type="button"
      data-testid="audit-table-row"
      onClick={() => { onSelect(entry); }}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr 120px 100px',
        alignItems: 'center',
        gap: 0,
        width: '100%',
        padding: 'var(--kp-space-xs) var(--kp-space-md)',
        background: hovered ? 'rgba(10,37,64,0.02)' : 'transparent',
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
    >
      {/* Timestamp */}
      <div
        style={{
          fontSize: 'var(--kp-font-xs)',
          color: 'var(--color-muted-foreground)',
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          paddingRight: 12,
          flexShrink: 0,
        }}
      >
        {formatTimestamp(entry.timestamp)}
      </div>

      {/* Action + description */}
      <div style={{ paddingRight: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              borderRadius: 'var(--radius-sm)',
              background: iconBg,
              flexShrink: 0,
            }}
          >
            {renderActionIcon(ACTION_ICONS, entry.action, { width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', color: iconColor, strokeWidth: 2 })}
          </span>
          <span
            style={{
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-semibold)',
              color: iconColor,
              whiteSpace: 'nowrap',
            }}
          >
            {lookupLabel(ACTION_LABELS, entry.action)}
          </span>
          {entry.model !== undefined && entry.model !== '' && (
            <Badge variant="neutral" size="sm" mono>{displayModelLabel(entry.model)}</Badge>
          )}
        </div>
        <div
          style={{
            fontSize: 'var(--kp-font-sm)',
            color: '#1e293b',
            lineHeight: 'var(--kp-leading-snug)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entry.description}
        </div>
      </div>

      {/* Actor / user decision */}
      <div
        style={{
          fontSize: 'var(--kp-font-xs)',
          color: 'var(--color-muted-foreground)',
          paddingRight: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.userDecision === 'approved' && (
          <Badge variant="success">Approved</Badge>
        )}
        {entry.userDecision === 'rejected' && (
          <Badge variant="danger">Rejected</Badge>
        )}
        {entry.userDecision === 'auto' && (
          <span style={{ color: 'var(--color-muted-foreground)' }}>Auto</span>
        )}
        {entry.userDecision === undefined && (
          <span style={{ color: 'var(--color-muted-foreground)' }}></span>
        )}
      </div>

      {/* Scope pill */}
      <div>
        {scopeLabel !== null && (
          <span data-testid="audit-scope-pill">
            <Badge
              variant={
                scopeLabel === 'Local' ? 'local' :
                scopeLabel === 'Direct' ? 'direct' :
                scopeLabel === 'Assured' ? 'assured' :
                'neutral'
              }
              size="sm"
            >
              {scopeLabel}
            </Badge>
          </span>
        )}
        {/* No badge for genuinely unscoped events (settings changes, key events,
            generic user actions): getScopeLabel already returns the explicit
            "All clients" badge for true all-matters retrieval/scope events, so a
            blank cell here honestly means "this action had no client scope" —
            not "applies to every client". */}
      </div>
    </button>
  );
}

// ── Table header ───────────────────────────────────────────────────────────

export function TableHeader() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr 120px 100px',
        padding: '0 var(--kp-space-md)',
        borderBottom: '2px solid var(--color-border)',
        background: 'rgba(10,37,64,0.025)',
      }}
    >
      <Eyebrow style={{ padding: '9px 0' }}>Timestamp</Eyebrow>
      <Eyebrow style={{ padding: '9px 0' }}>Action / Description</Eyebrow>
      <Eyebrow style={{ padding: '9px 0' }}>Actor</Eyebrow>
      <Eyebrow style={{ padding: '9px 0' }}>Scope</Eyebrow>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

export function AuditEmptyState() {
  return (
    /* eslint-disable lantern-i18n/no-hardcoded-string */
    <div data-testid="audit-empty-state">
      <EmptyState
        icon={ShieldCheck}
        title="No activity logged yet"
        body="Every AI request, file operation, workflow run, and governance action will appear here. This record stays on your machine and is yours to export whenever you need it."
      />
    </div>
    /* eslint-enable lantern-i18n/no-hardcoded-string */
  );
}

// ── No-match state (filter active, zero results) ───────────────────────────

export interface AuditNoMatchStateProps {
  onClearFilters: () => void;
}

export function AuditNoMatchState({ onClearFilters }: AuditNoMatchStateProps) {
  return (
    /* eslint-disable lantern-i18n/no-hardcoded-string */
    <div data-testid="audit-no-match-state">
      <EmptyState
        icon={Search}
        title="No activity matches your filters."
        body="Your search or filters did not match any logged activity. Try broadening your search or clearing the filters to see all entries."
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={X}
            data-testid="audit-no-match-clear"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
        }
      />
    </div>
    /* eslint-enable lantern-i18n/no-hardcoded-string */
  );
}

// ── Filter panel ───────────────────────────────────────────────────────────

export type CategoryFilter = ActionCategory | 'all';

export interface AuditFilterPanelProps {
  categoryFilter: CategoryFilter;
  onCategoryChange: (c: CategoryFilter) => void;
  selectedTypes: Set<AuditActionType>;
  onToggleType: (t: AuditActionType) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  availableModels: string[];
  modelFilter: string;
  onModelChange: (v: string) => void;
  availableMatterScopes: AuditMatterScopeOption[];
  matterIdFilter: string;
  onMatterChange: (v: string) => void;
  activeFilterCount: number;
  onReset: () => void;
}

export function AuditFilterPanel({
  categoryFilter,
  onCategoryChange,
  selectedTypes,
  onToggleType,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  availableModels,
  modelFilter,
  onModelChange,
  availableMatterScopes,
  matterIdFilter,
  onMatterChange,
  activeFilterCount,
  onReset,
}: AuditFilterPanelProps) {
  const entityLabel = useEntityLabel();
  const categories: CategoryFilter[] = ['all', 'file', 'ai', 'workflow', 'privilege', 'firm', 'system'];

  const inputStyle: React.CSSProperties = {
    height: 'var(--kp-control-sm)',
    padding: '0 8px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: '#fff',
    fontSize: 'var(--kp-font-xs)',
    color: 'var(--kp-navy)',
    outline: 'none',
  };

  return (
    <FilterPanel data-testid="audit-filter-panel">
      {/* Category chips */}
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>Category</Eyebrow>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((cat) => {
            const active = categoryFilter === cat;
            const catLabel = cat === 'all' ? 'All categories' : (CATEGORY_LABEL as Record<string, string>)[cat] ?? cat;
            return (
              <Chip
                key={cat}
                active={active}
                size="sm"
                onClick={() => { onCategoryChange(cat); }}
              >
                {catLabel}
              </Chip>
            );
          })}
        </div>
      </div>

      {/* Date + model row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <Eyebrow style={{ marginBottom: 6 }}>From</Eyebrow>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { onDateFromChange(e.target.value); }}
            data-testid="audit-home-filter-date-from"
            style={inputStyle}
            aria-label="Filter by date from"
          />
        </div>
        <div>
          <Eyebrow style={{ marginBottom: 6 }}>To</Eyebrow>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { onDateToChange(e.target.value); }}
            data-testid="audit-home-filter-date-to"
            style={inputStyle}
            aria-label="Filter by date to"
          />
        </div>
        {availableModels.length > 0 && (
          <div>
            <Eyebrow style={{ marginBottom: 6 }}>Model</Eyebrow>
            <select
              value={modelFilter}
              onChange={(e) => { onModelChange(e.target.value); }}
              data-testid="audit-home-filter-model"
              style={{ ...inputStyle, paddingRight: 24 }}
              aria-label="Filter by model"
            >
              <option value="">All models</option>
              {availableModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Eyebrow style={{ marginBottom: 6 }}>{entityLabel.One}</Eyebrow>
          <select
            value={matterIdFilter}
            onChange={(e) => { onMatterChange(e.target.value); }}
            data-testid="audit-home-filter-matter"
            style={{ ...inputStyle, minWidth: 180, paddingRight: 24 }}
            aria-label={`Filter by ${entityLabel.one}`}
          >
            <option value="">{`All ${entityLabel.other}`}</option>
            {availableMatterScopes.map((scope) => (
              <option key={scope.matterId} value={scope.matterId}>{scope.label}</option>
            ))}
          </select>
        </div>
        {activeFilterCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            iconLeft={X}
            data-testid="audit-home-filter-reset"
            onClick={onReset}
          >
            Reset
          </Button>
        )}
      </div>

      {/* Action-type chip filter (secondary, within selected category) */}
      {categoryFilter !== 'all' && (
        <div>
          <Eyebrow style={{ marginBottom: 6 }}>Action type</Eyebrow>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {(Object.entries(ACTION_CATEGORY) as [AuditActionType, ActionCategory][])
              .filter(([, cat]) => cat === categoryFilter)
              .map(([type]) => {
                // categoryFilter !== 'all' is guaranteed by the outer guard.
                const active = selectedTypes.has(type);
                return (
                  <Chip
                    key={type}
                    active={active}
                    size="sm"
                    onClick={() => { onToggleType(type); }}
                  >
                    {lookupLabel(ACTION_LABELS, type)}
                  </Chip>
                );
              })}
          </div>
        </div>
      )}
    </FilterPanel>
  );
}
