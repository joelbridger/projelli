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

import React, {
  useState,
  useMemo,
  useCallback,
  useDeferredValue,
} from 'react';
import {
  ShieldCheck,
  Search,
  Download,
  X,
  History,
  FilePlus,
  FileText,
  FileX,
  FolderInput,
  PenLine,
  Play,
  CheckCircle,
  XCircle,
  Cpu,
  Scissors,
  User,
  Search as SearchIcon,
  ShieldOff,
  Lock,
  Target,
  Send,
  Share2,
  Users2,
  KeyRound,
  UserX,
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
  FilterPanel,
  Badge,
  Chip,
  Eyebrow,
  Card,
  EmptyState,
  SlidePanel,
} from '@/components/ui/kp';

// ── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

// ── Typed-map helpers ──────────────────────────────────────────────────────
// Runtime audit entries from old schema may carry action strings not in the
// current enum. These helpers accept `string` so we never get a TS error on
// the lookup, and fall back cleanly when a key is absent.

type AnyRecord<V> = Record<string, V | undefined>;

function lookupLabel(map: Record<AuditActionType, string>, action: string): string {
  return (map as AnyRecord<string>)[action] ?? action;
}

function lookupCategory(map: Record<AuditActionType, ActionCategory>, action: string): ActionCategory {
  return (map as AnyRecord<ActionCategory>)[action] ?? 'system';
}

function toSafeString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Render an action icon without creating a component variable during render. */
function renderActionIcon(
  map: Record<AuditActionType, React.ElementType>,
  action: string,
  style: React.CSSProperties
): React.ReactNode {
  const Comp = (map as AnyRecord<React.ElementType>)[action] ?? History;
  return React.createElement(Comp, { style });
}

// ── Action metadata ────────────────────────────────────────────────────────

const ACTION_ICONS: Record<AuditActionType, React.ElementType> = {
  file_create: FilePlus,
  file_update: FileText,
  file_delete: FileX,
  file_move: FolderInput,
  file_rename: PenLine,
  workflow_start: Play,
  workflow_complete: CheckCircle,
  workflow_fail: XCircle,
  model_call: Cpu,
  context_compressed: Scissors,
  user_action: User,
  retrieval_executed: SearchIcon,
  citation_verified: ShieldCheck,
  privilege_evaluated: Lock,
  scope_active: Target,
  egress: Send,
  mcp_blocked: ShieldOff,
  matter_shared: Share2,
  matter_unshared: Share2,
  member_invited: Users2,
  member_removed: Users2,
  wall_set_from_manager: ShieldOff,
  key_published: KeyRound,
  seat_revoked: UserX,
};

const ACTION_LABELS: Record<AuditActionType, string> = {
  file_create: 'File Created',
  file_update: 'File Updated',
  file_delete: 'File Deleted',
  file_move: 'File Moved',
  file_rename: 'File Renamed',
  workflow_start: 'Workflow Started',
  workflow_complete: 'Workflow Completed',
  workflow_fail: 'Workflow Failed',
  model_call: 'Model Call',
  context_compressed: 'Context Compressed',
  user_action: 'User Action',
  retrieval_executed: 'Files Searched',
  citation_verified: 'Citation Checked',
  privilege_evaluated: 'Privilege Checked',
  scope_active: 'Active Matter',
  egress: 'AI Request Sent',
  mcp_blocked: 'External AI Write Blocked',
  matter_shared: 'Matter Shared',
  matter_unshared: 'Matter Unshared',
  member_invited: 'Member Invited',
  member_removed: 'Member Removed',
  wall_set_from_manager: 'Ethical Wall Set',
  key_published: 'Key Published',
  seat_revoked: 'Seat Revoked',
};

/** Semantic category per action, drives colour + grouping in filters. */
type ActionCategory = 'file' | 'ai' | 'workflow' | 'privilege' | 'firm' | 'system';

const ACTION_CATEGORY: Record<AuditActionType, ActionCategory> = {
  file_create: 'file',
  file_update: 'file',
  file_delete: 'file',
  file_move: 'file',
  file_rename: 'file',
  workflow_start: 'workflow',
  workflow_complete: 'workflow',
  workflow_fail: 'workflow',
  model_call: 'ai',
  context_compressed: 'ai',
  user_action: 'system',
  retrieval_executed: 'ai',
  citation_verified: 'ai',
  privilege_evaluated: 'privilege',
  scope_active: 'privilege',
  egress: 'ai',
  mcp_blocked: 'privilege',
  matter_shared: 'firm',
  matter_unshared: 'firm',
  member_invited: 'firm',
  member_removed: 'firm',
  wall_set_from_manager: 'firm',
  key_published: 'firm',
  seat_revoked: 'firm',
};

const CATEGORY_COLOR: Record<ActionCategory, string> = {
  file: '#16a34a',    // green-600
  ai: '#7c3aed',     // violet-600
  workflow: '#9333ea', // purple-600
  privilege: '#4f46e5', // indigo-600
  firm: '#0284c7',   // sky-600
  system: '#64748b', // slate-500
};

const CATEGORY_BG: Record<ActionCategory, string> = {
  file: 'rgba(22,163,74,0.10)',
  ai: 'rgba(124,58,237,0.09)',
  workflow: 'rgba(147,51,234,0.09)',
  privilege: 'rgba(79,70,229,0.09)',
  firm: 'rgba(2,132,199,0.09)',
  system: 'rgba(100,116,139,0.09)',
};

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  file: 'File ops',
  ai: 'AI Requests',
  workflow: 'Workflow',
  privilege: 'Privilege',
  firm: 'Firm',
  system: 'System',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatFullTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Scope pill ─────────────────────────────────────────────────────────────

/** Reads confidentiality scope from egress / scope_active metadata if present. */
function getScopeLabel(entry: AuditEntry): string | null {
  const meta = entry.metadata;
  if (entry.action === 'egress') {
    const mode = meta['mode'];
    if (mode === 'local-only') return 'Local';
    if (mode === 'direct') return 'Direct';
    if (mode === 'assured') return 'Assured';
  }
  if (entry.action === 'scope_active' || entry.action === 'retrieval_executed') {
    const scope = meta['scope'] as { kind?: string; matterName?: string } | undefined;
    if (scope?.kind === 'allMatters') return 'All matters';
    if (scope?.kind === 'matter') return scope.matterName ?? 'Matter';
  }
  return null;
}


// ── Detail panel ───────────────────────────────────────────────────────────

interface DetailPanelProps {
  entry: AuditEntry;
  onClose: () => void;
}

function DetailPanel({ entry, onClose }: DetailPanelProps) {
  const category = lookupCategory(ACTION_CATEGORY, entry.action);
  const iconColor = CATEGORY_COLOR[category];
  const scopeLabel = getScopeLabel(entry);
  const hasInputs = Object.keys(entry.inputs).length > 0;
  const hasOutputs = Object.keys(entry.outputs).length > 0;
  const hasMetadata = Object.keys(entry.metadata).length > 0;

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
          {entry.model !== undefined && <MetaField label="Model" value={entry.model} />}
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
          const fmid = entry.metadata['firm_matter_id'];
          const mid = entry.metadata['matter_id'];
          const tuid = entry.metadata['target_user_id'];
          const oid = entry.metadata['org_id'];
          if (fmid == null && mid == null && tuid == null) return null;
          const sfmid = toSafeString(fmid);
          const smid = toSafeString(mid);
          const stuid = toSafeString(tuid);
          const soid = toSafeString(oid);
          return (
            <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sfmid && <GovRow label="Firm matter" value={sfmid} />}
              {smid && smid !== sfmid && <GovRow label="Local matter" value={smid} />}
              {stuid && <GovRow label="Target user" value={stuid} />}
              {soid && <GovRow label="Org" value={soid} />}
            </div>
          );
        })()}

        {/* Inputs */}
        {hasInputs && (
          <JsonBlock label="Inputs" value={entry.inputs} />
        )}

        {/* Outputs */}
        {hasOutputs && (
          <JsonBlock label="Outputs" value={entry.outputs} />
        )}

        {/* Metadata */}
        {hasMetadata && (
          <JsonBlock label="Metadata" value={entry.metadata} />
        )}
      </div>
    </SlidePanel>
  );
}

interface MetaFieldProps {
  label: string;
  value: string | undefined;
  mono?: boolean;
  truncate?: boolean;
}

function MetaField({ label, value, mono = false, truncate = false }: MetaFieldProps) {
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

interface GovRowProps { label: string; value: string }
function GovRow({ label, value }: GovRowProps) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)', width: 100, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--kp-font-2xs)', fontFamily: 'ui-monospace, SFMono-Regular, monospace', color: 'var(--kp-navy)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

interface JsonBlockProps { label: string; value: Record<string, unknown> }
function JsonBlock({ label, value }: JsonBlockProps) {
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

interface AuditRowProps {
  entry: AuditEntry;
  onSelect: (entry: AuditEntry) => void;
}

function AuditRow({ entry, onSelect }: AuditRowProps) {
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
            <Badge variant="neutral" size="sm" mono>{entry.model}</Badge>
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
      </div>
    </button>
  );
}

// ── Table header ───────────────────────────────────────────────────────────

function TableHeader() {
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

function AuditEmptyState() {
  return (
    /* eslint-disable keepance-i18n/no-hardcoded-string */
    <div data-testid="audit-empty-state">
      <EmptyState
        icon={ShieldCheck}
        title="No activity logged yet"
        body="Every AI request, file operation, workflow run, and governance action will appear here. This record stays on your machine and is yours to export whenever you need it."
      />
    </div>
    /* eslint-enable keepance-i18n/no-hardcoded-string */
  );
}

// ── No-match state (filter active, zero results) ───────────────────────────

interface AuditNoMatchStateProps {
  onClearFilters: () => void;
}

function AuditNoMatchState({ onClearFilters }: AuditNoMatchStateProps) {
  return (
    /* eslint-disable keepance-i18n/no-hardcoded-string */
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
    /* eslint-enable keepance-i18n/no-hardcoded-string */
  );
}

// ── Filter panel ───────────────────────────────────────────────────────────

type CategoryFilter = ActionCategory | 'all';

interface AuditFilterPanelProps {
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
  activeFilterCount: number;
  onReset: () => void;
}

function AuditFilterPanel({
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
  activeFilterCount,
  onReset,
}: AuditFilterPanelProps) {
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
      {/* Page header */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        <SurfaceHeader
          Icon={ShieldCheck}
          title="Activity Log"
          description="Every AI request, file change, and workflow run in your workspace, logged and exportable."
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <SearchField
                size="md"
                style={{ width: 240 }}
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
                CSV
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
                JSON
              </Button>
            </div>
          }
        />
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
      </div>

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

      {/* Result count + export filter note — shown below header when filters/search are active */}
      {(searchQuery || activeFilterCount > 0 || (filteredEntries.length > 0 && filteredEntries.length < entries.length)) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '4px var(--kp-gutter)',
            borderBottom: showFilters ? 'none' : '1px solid var(--color-border)',
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

      {/* Filter panel (expanded) */}
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
                    Load {String(Math.min(PAGE_SIZE, filteredEntries.length - visibleCount))} more
                  </Button>
                  <span style={{ marginLeft: 12, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                    showing {String(visibleEntries.length)} of {String(filteredEntries.length)}
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
