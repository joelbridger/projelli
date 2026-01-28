// Audit Log Viewer Component
// Displays the audit log with filtering and search

import { useState, useCallback, useMemo } from 'react';
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
  Download,
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
} from 'lucide-react';
import type { AuditEntry, AuditActionType } from '@/types/audit';

interface AuditLogProps {
  entries: AuditEntry[];
  onExportJSON?: () => void;
  onExportCSV?: () => void;
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
  user_action: User,
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
  user_action: 'User Action',
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
  user_action: 'text-gray-600 dark:text-gray-400',
};

export function AuditLog({
  entries,
  onExportJSON,
  onExportCSV,
  className,
}: AuditLogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<AuditActionType>>(
    new Set()
  );
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Filter by action type
      if (selectedTypes.size > 0 && !selectedTypes.has(entry.action)) {
        return false;
      }

      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          entry.description.toLowerCase().includes(query) ||
          entry.action.toLowerCase().includes(query) ||
          (entry.model && entry.model.toLowerCase().includes(query))
        );
      }

      return true;
    });
  }, [entries, selectedTypes, searchQuery]);

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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5" />
          <span className="font-medium">AI Audit Log</span>
          <span className="text-xs text-muted-foreground">
            ({filteredEntries.length} entries)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onExportJSON && (
            <Button variant="ghost" size="sm" onClick={onExportJSON}>
              <Download className="h-4 w-4 mr-1" />
              JSON
            </Button>
          )}
          {onExportCSV && (
            <Button variant="ghost" size="sm" onClick={onExportCSV}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          )}
        </div>
      </div>

      {/* Search and filters */}
      <div className="px-4 py-2 border-b space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8"
            />
          </div>
          <Button
            variant={showFilters ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filter
            {selectedTypes.size > 0 && (
              <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5">
                {selectedTypes.size}
              </span>
            )}
          </Button>
        </div>

        {/* Filter chips */}
        {showFilters && (
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
        )}
      </div>

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto">
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4 text-center">
            <History className="h-12 w-12 mb-3 opacity-20" />
            <p className="text-sm font-medium mb-2">No audit entries yet</p>
            <p className="text-xs max-w-[280px]">
              AI actions like file changes, workflow runs, and model calls will appear here for transparency.
            </p>
          </div>
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
            <DialogTitle>Audit Entry Details</DialogTitle>
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
