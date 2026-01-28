// Backlinks Panel Component
// Shows documents that link to the current document

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { FileText, Link, ExternalLink } from 'lucide-react';
import type { BacklinkEntry } from '@/modules/editor/BacklinkIndex';

interface BacklinksPanelProps {
  backlinks: BacklinkEntry[];
  onNavigate?: (path: string, lineNumber?: number) => void;
  className?: string;
}

export function BacklinksPanel({
  backlinks,
  onNavigate,
  className,
}: BacklinksPanelProps) {
  // Group backlinks by source document
  const groupedBacklinks = useMemo(() => {
    const grouped = new Map<string, BacklinkEntry[]>();

    for (const backlink of backlinks) {
      const existing = grouped.get(backlink.sourcePath) ?? [];
      existing.push(backlink);
      grouped.set(backlink.sourcePath, existing);
    }

    return grouped;
  }, [backlinks]);

  if (backlinks.length === 0) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>
        <div className="flex items-center gap-2 mb-2">
          <Link className="h-4 w-4" />
          <span className="font-medium">Backlinks</span>
        </div>
        <p className="text-xs">No other documents link to this file.</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto', className)}>
      <div className="p-2">
        <div className="flex items-center gap-2 px-2 py-1 mb-1">
          <Link className="h-4 w-4" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Backlinks ({backlinks.length})
          </span>
        </div>

        <div className="space-y-2">
          {Array.from(groupedBacklinks.entries()).map(([sourcePath, entries]) => (
            <BacklinkGroup
              key={sourcePath}
              sourcePath={sourcePath}
              entries={entries}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface BacklinkGroupProps {
  sourcePath: string;
  entries: BacklinkEntry[];
  onNavigate: ((path: string, lineNumber?: number) => void) | undefined;
}

function BacklinkGroup({ sourcePath, entries, onNavigate }: BacklinkGroupProps) {
  const fileName = getFileName(sourcePath);

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Document header */}
      <button
        onClick={() => onNavigate?.(sourcePath)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-2 text-sm font-medium',
          'bg-muted/50 hover:bg-muted transition-colors text-left'
        )}
      >
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{fileName}</span>
        <ExternalLink className="h-3 w-3 ml-auto opacity-50" />
      </button>

      {/* Link contexts */}
      <div className="divide-y">
        {entries.map((entry, index) => (
          <button
            key={`${entry.link.lineNumber}-${index}`}
            onClick={() => onNavigate?.(sourcePath, entry.link.lineNumber)}
            className={cn(
              'w-full px-3 py-2 text-xs text-left',
              'hover:bg-accent/50 transition-colors',
              'text-muted-foreground hover:text-foreground'
            )}
          >
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground/50 flex-shrink-0">
                L{entry.link.lineNumber}
              </span>
              <span className="break-words">
                {highlightLink(entry.context, entry.link.target)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Extract file name from path
 */
function getFileName(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1] ?? path;
}

/**
 * Highlight the wiki link in context text
 */
function highlightLink(context: string, target: string): React.ReactNode {
  const linkPattern = new RegExp(`\\[\\[${escapeRegex(target)}(\\|[^\\]]+)?\\]\\]`, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  linkPattern.lastIndex = 0;
  while ((match = linkPattern.exec(context)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {context.slice(lastIndex, match.index)}
        </span>
      );
    }

    // Add the highlighted match
    parts.push(
      <span
        key={`link-${match.index}`}
        className="bg-primary/20 text-primary rounded px-0.5"
      >
        {match[0]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < context.length) {
    parts.push(<span key={`text-${lastIndex}`}>{context.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : context;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default BacklinksPanel;
