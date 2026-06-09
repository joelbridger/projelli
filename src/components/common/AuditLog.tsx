// Audit Log Viewer Component
// Displays the audit log with filtering and search

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  History,
  Search,
  ChevronDown,
  ChevronRight,
  FileText,
  FilePlus,
  FileX,
  FolderInput,
  PenLine,
  Play,
  CheckCircle,
  XCircle,
  Cpu,
  User,
  Filter,
  X,
  Scissors,
  Search as SearchIcon,
  ShieldCheck,
  ShieldOff,
  Lock,
  Target,
  Send,
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/types/audit';
import { EmptyState } from './EmptyState';
import {
  downloadAuditCSV,
  downloadAuditJSON,
  filterEntries,
  uniqueModels,
} from '@/utils/audit-export';
import { isAuditEncrypted } from '@/modules/audit/AuditService';

interface AuditLogProps {
  entries: AuditEntry[];
  /**
   * Optional custom JSON exporter. If omitted, clicking "JSON" serializes
   * `entries` and triggers a browser download directly.
   */
  onExportJSON?: (entries: AuditEntry[]) => void;
  /**
   * Optional custom CSV exporter. If omitted, clicking "CSV" serializes
   * `entries` and triggers a browser download directly.
   */
  onExportCSV?: (entries: AuditEntry[]) => void;
  className?: string;
}

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
  // Keepance 3.0 provenance events.
  retrieval_executed: SearchIcon,
  citation_verified: ShieldCheck,
  privilege_evaluated: Lock,
  scope_active: Target,
  egress: Send,
  mcp_blocked: ShieldOff,
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
  // Keepance 3.0 provenance events.
  retrieval_executed: 'Files Searched',
  citation_verified: 'Citation Checked',
  privilege_evaluated: 'Privilege Checked',
  scope_active: 'Active Matter',
  egress: 'AI Request Sent',
  mcp_blocked: 'MCP Write Blocked',
};

const ACTION_COLORS: Record<AuditActionType, string> = {
  file_create: 'text-green-600 dark:text-green-400',
  file_update: 'text-blue-600 dark:text-blue-400',
  file_delete: 'text-red-600 dark:text-red-400',
  file_move: 'text-blue-600 dark:text-blue-400',
  file_rename: 'text-blue-600 dark:text-blue-400',
  workflow_start: 'text-purple-600 dark:text-purple-400',
  workflow_complete: 'text-green-600 dark:text-green-400',
  workflow_fail: 'text-red-600 dark:text-red-400',
  model_call: 'text-amber-600 dark:text-amber-400',
  context_compressed: 'text-orange-600 dark:text-orange-400',
  user_action: 'text-gray-600 dark:text-gray-400',
  // Keepance 3.0 provenance events.
  retrieval_executed: 'text-sky-600 dark:text-sky-400',
  citation_verified: 'text-emerald-600 dark:text-emerald-400',
  privilege_evaluated: 'text-indigo-600 dark:text-indigo-400',
  scope_active: 'text-teal-600 dark:text-teal-400',
  egress: 'text-violet-600 dark:text-violet-400',
  mcp_blocked: 'text-rose-600 dark:text-rose-400',
};

export function AuditLog({
  entries,
  onExportJSON,
  onExportCSV,
  className,
}: AuditLogProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditActionType>>(
    new Set()
  );
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [modelFilter, setModelFilter] = useState<string>('');
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Unique model list derived from current entries, for the model dropdown.
  const availableModels = useMemo(() => uniqueModels(entries), [entries]);

  // Filter entries (composes action type + date range + model + search).
  const filteredEntries = useMemo(
    () =>
      filterEntries(entries, {
        actionTypes: selectedTypes,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        model: modelFilter || undefined,
        searchQuery: searchQuery || undefined,
      }),
    [entries, selectedTypes, dateFrom, dateTo, modelFilter, searchQuery]
  );

  const activeFilterCount =
    selectedTypes.size +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (modelFilter ? 1 : 0);

  const handleResetFilters = useCallback(() => {
    setSelectedTypes(new Set());
    setDateFrom('');
    setDateTo('');
    setModelFilter('');
  }, []);

  const handleExportJSON = useCallback(() => {
    if (onExportJSON) {
      onExportJSON(filteredEntries);
    } else {
      downloadAuditJSON(filteredEntries);
    }
  }, [filteredEntries, onExportJSON]);

  const handleExportCSV = useCallback(() => {
    if (onExportCSV) {
      onExportCSV(filteredEntries);
    } else {
      downloadAuditCSV(filteredEntries);
    }
  }, [filteredEntries, onExportCSV]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleFilter = useCallback((type: AuditActionType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header — sized for the narrow sidebar slot. Title is truncated,
          export buttons are icon-only with tooltips, entry count hugs the
          title so the whole row stays on one line. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <History className="h-4 w-4 shrink-0" />
          <span className="font-medium text-sm truncate">AI Audit</span>
          <span className="text-xs text-muted-foreground shrink-0">
            ({filteredEntries.length})
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[10px] font-medium"
            onClick={handleExportJSON}
            data-testid="audit-log-export-json-btn"
            disabled={filteredEntries.length === 0}
            title="Export JSON"
            aria-label="Export JSON"
          >
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-[10px] font-medium"
            onClick={handleExportCSV}
            data-testid="audit-log-export-csv-btn"
            disabled={filteredEntries.length === 0}
            title="Export CSV"
            aria-label="Export CSV"
          >
            CSV
          </Button>
        </div>
      </div>

      {/* Protective framing — pre-empts the "surveillance" misread by naming
          what this log is FOR: the user's own files and defense, kept on their
          own machine. Light, reassuring, one line. (No em dashes.) The at-rest
          line is honest about encryption: encrypted on the desktop app, and
          clearly NOT encrypted in the browser (use the desktop app for
          sensitive work). */}
      <div
        className="flex items-start gap-2 px-3 py-2 border-b bg-sky-50 text-sky-900"
        data-testid="audit-log-protective-header"
      >
        <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
        <div className="min-w-0">
          <p className="text-xs leading-snug">
            Your private record of every AI action, kept on your machine for your
            files and your defense.
          </p>
          {isAuditEncrypted() ? (
            <p
              className="text-[11px] leading-snug text-sky-700 mt-0.5"
              data-testid="audit-log-encrypted-note"
            >
              Encrypted at rest on this device.
            </p>
          ) : (
            <p
              className="text-[11px] leading-snug text-amber-700 mt-0.5"
              data-testid="audit-log-unencrypted-note"
            >
              Stored in your browser and not encrypted. Use the desktop app for
              confidential work.
            </p>
          )}
        </div>
      </div>

      {/* Search and filters — sized for the narrow sidebar slot. */}
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
          </div>
          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-1.5 shrink-0"
            onClick={() => setShowFilters(!showFilters)}
            title={activeFilterCount > 0 ? `Filter ${activeFilterCount}` : 'Filter'}
            aria-label={activeFilterCount > 0 ? `Filter ${activeFilterCount}` : 'Filter'}
          >
            <Filter className="h-3.5 w-3.5" />
            {activeFilterCount > 0 && (
              <span className="ml-1 text-[10px] bg-primary text-primary-foreground rounded-full px-1">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {/* Filter chips + date/model pickers */}
        {showFilters && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(ACTION_LABELS) as AuditActionType[]).map((type) => (
                <Button
                  key={type}
                  variant={selectedTypes.has(type) ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => toggleFilter(type)}
                >
                  {ACTION_LABELS[type]}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="audit-log-filter-date-from"
                  className="ml-1 h-6 rounded border border-input bg-background px-1.5 text-xs"
                  aria-label="Filter by date from"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="audit-log-filter-date-to"
                  className="ml-1 h-6 rounded border border-input bg-background px-1.5 text-xs"
                  aria-label="Filter by date to"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Model
                <select
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  data-testid="audit-log-filter-model"
                  className="ml-1 h-6 rounded border border-input bg-background px-1.5 text-xs"
                  aria-label="Filter by model"
                  disabled={availableModels.length === 0}
                >
                  <option value="">All models</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={handleResetFilters}
                  data-testid="audit-log-filter-reset"
                >
                  <X className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <EmptyState
            panelName="audit"
            icon={History}
            title="No AI actions yet"
            description="Every AI action in your workspace — file changes, workflow runs, model calls — gets logged here so you can review or audit what happened."
          />
        ) : (
          <div className="divide-y">
            {filteredEntries.map((entry) => (
              <AuditEntryRow
                key={entry.id}
                entry={entry}
                isExpanded={expandedEntries.has(entry.id)}
                onToggleExpand={() => toggleExpanded(entry.id)}
                onViewDetails={() => setDetailEntry(entry)}
                formatTimestamp={formatTimestamp}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail dialog */}
      <Dialog
        open={detailEntry !== null}
        onOpenChange={() => setDetailEntry(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('common.audit-log.entry-details-title')}</DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <AuditEntryDetails
              entry={detailEntry}
              formatTimestamp={formatTimestamp}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AuditEntryRowProps {
  entry: AuditEntry;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onViewDetails: () => void;
  formatTimestamp: (timestamp: string) => string;
}

function AuditEntryRow({
  entry,
  isExpanded,
  onToggleExpand,
  onViewDetails,
  formatTimestamp,
}: AuditEntryRowProps) {
  const Icon = ACTION_ICONS[entry.action] ?? History;
  const colorClass = ACTION_COLORS[entry.action] ?? 'text-muted-foreground';

  const hasDetails =
    Object.keys(entry.inputs).length > 0 ||
    Object.keys(entry.outputs).length > 0;

  return (
    <div className="hover:bg-muted/50">
      <div className="flex items-start gap-2 px-3 py-2.5">
        {/* Expand button */}
        <button
          onClick={onToggleExpand}
          className="mt-0.5 p-0.5 rounded hover:bg-muted flex-shrink-0"
          disabled={!hasDetails}
        >
          {hasDetails ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <div className="w-3.5" />
          )}
        </button>

        {/* Icon */}
        <Icon className={cn('h-4 w-4 mt-0.5 flex-shrink-0', colorClass)} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm leading-tight break-words">{entry.description}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(entry.timestamp)}
                </span>
                {entry.model && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {entry.model}
                  </span>
                )}
              </div>
              {entry.userDecision && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  {entry.userDecision === 'approved' && '✓ Approved'}
                  {entry.userDecision === 'rejected' && '✗ Rejected'}
                  {entry.userDecision === 'auto' && 'Auto'}
                </div>
              )}
            </div>
            {hasDetails && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs flex-shrink-0"
                onClick={onViewDetails}
              >
                View
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && hasDetails && (
        <div className="px-3 pb-2 ml-9 space-y-2">
          {Object.keys(entry.inputs).length > 0 && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Inputs:</span>
              <pre className="mt-1 p-2 rounded bg-muted text-[10px] overflow-x-auto font-mono">
                {JSON.stringify(entry.inputs, null, 2)}
              </pre>
            </div>
          )}
          {Object.keys(entry.outputs).length > 0 && (
            <div className="text-xs">
              <span className="font-medium text-muted-foreground">Outputs:</span>
              <pre className="mt-1 p-2 rounded bg-muted text-[10px] overflow-x-auto font-mono">
                {JSON.stringify(entry.outputs, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AuditEntryDetailsProps {
  entry: AuditEntry;
  formatTimestamp: (timestamp: string) => string;
}

function AuditEntryDetails({ entry, formatTimestamp }: AuditEntryDetailsProps) {
  const Icon = ACTION_ICONS[entry.action] ?? History;
  const colorClass = ACTION_COLORS[entry.action] ?? 'text-muted-foreground';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={cn('h-6 w-6', colorClass)} />
        <div>
          <div className="font-medium">{ACTION_LABELS[entry.action]}</div>
          <div className="text-sm text-muted-foreground">
            {entry.description}
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground uppercase">
            Timestamp
          </div>
          <div>{formatTimestamp(entry.timestamp)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">ID</div>
          <div className="font-mono text-xs">{entry.id}</div>
        </div>
        {entry.model && (
          <div>
            <div className="text-xs text-muted-foreground uppercase">Model</div>
            <div>{entry.model}</div>
          </div>
        )}
        {entry.userDecision && (
          <div>
            <div className="text-xs text-muted-foreground uppercase">
              User Decision
            </div>
            <div className="capitalize">{entry.userDecision}</div>
          </div>
        )}
      </div>

      {/* Inputs */}
      {Object.keys(entry.inputs).length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">
            Inputs
          </div>
          <pre className="p-3 rounded bg-muted text-xs overflow-x-auto max-h-40">
            {JSON.stringify(entry.inputs, null, 2)}
          </pre>
        </div>
      )}

      {/* Outputs */}
      {Object.keys(entry.outputs).length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">
            Outputs
          </div>
          <pre className="p-3 rounded bg-muted text-xs overflow-x-auto max-h-40">
            {JSON.stringify(entry.outputs, null, 2)}
          </pre>
        </div>
      )}

      {/* Metadata */}
      {Object.keys(entry.metadata).length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">
            Additional Metadata
          </div>
          <pre className="p-3 rounded bg-muted text-xs overflow-x-auto max-h-40">
            {JSON.stringify(entry.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default AuditLog;
