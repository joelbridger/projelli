// Diff Viewer Component
// Displays differences between two versions of a file

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeDiff, type DiffResult, type DiffLine } from '@/utils/diff';

interface DiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  originalLabel?: string;
  modifiedLabel?: string;
  className?: string;
  showLineNumbers?: boolean;
  viewMode?: 'unified' | 'split';
}

export function DiffViewer({
  originalContent,
  modifiedContent,
  originalLabel = 'Original',
  modifiedLabel = 'Modified',
  className,
  showLineNumbers = true,
  viewMode = 'unified',
}: DiffViewerProps) {
  const diff = useMemo(
    () => computeDiff(originalContent, modifiedContent),
    [originalContent, modifiedContent]
  );

  if (viewMode === 'split') {
    return (
      <SplitDiffView
        diff={diff}
        originalLabel={originalLabel}
        modifiedLabel={modifiedLabel}
        className={className}
        showLineNumbers={showLineNumbers}
      />
    );
  }

  return (
    <UnifiedDiffView
      diff={diff}
      originalLabel={originalLabel}
      modifiedLabel={modifiedLabel}
      className={className}
      showLineNumbers={showLineNumbers}
    />
  );
}

interface DiffViewProps {
  diff: DiffResult;
  originalLabel: string;
  modifiedLabel: string;
  className: string | undefined;
  showLineNumbers: boolean;
}

function UnifiedDiffView({
  diff,
  originalLabel,
  modifiedLabel,
  className,
  showLineNumbers,
}: DiffViewProps) {
  return (
    <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted border-b">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{originalLabel} → {modifiedLabel}</span>
        </div>
        <DiffStats diff={diff} />
      </div>

      {/* Diff content */}
      <div className="overflow-auto max-h-[500px] bg-background">
        <table className="w-full text-sm font-mono">
          <tbody>
            {diff.lines.map((line, index) => (
              <DiffLineRow
                key={index}
                line={line}
                showLineNumbers={showLineNumbers}
                mode="unified"
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SplitDiffView({
  diff,
  originalLabel,
  modifiedLabel,
  className,
  showLineNumbers,
}: DiffViewProps) {
  // Organize lines for split view
  const { leftLines, rightLines } = useMemo(() => {
    const left: (DiffLine | null)[] = [];
    const right: (DiffLine | null)[] = [];

    for (const line of diff.lines) {
      if (line.type === 'unchanged') {
        left.push(line);
        right.push(line);
      } else if (line.type === 'removed') {
        left.push(line);
        right.push(null);
      } else if (line.type === 'added') {
        left.push(null);
        right.push(line);
      }
    }

    return { leftLines: left, rightLines: right };
  }, [diff]);

  return (
    <div className={cn('flex flex-col border rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="flex border-b">
        <div className="flex-1 px-4 py-2 bg-muted border-r">
          <span className="text-sm text-muted-foreground">{originalLabel}</span>
        </div>
        <div className="flex-1 px-4 py-2 bg-muted flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{modifiedLabel}</span>
          <DiffStats diff={diff} />
        </div>
      </div>

      {/* Split content */}
      <div className="flex overflow-auto max-h-[500px]">
        {/* Left side (original) */}
        <div className="flex-1 border-r bg-background">
          <table className="w-full text-sm font-mono">
            <tbody>
              {leftLines.map((line, index) => (
                <DiffLineRow
                  key={index}
                  line={line}
                  showLineNumbers={showLineNumbers}
                  mode="split-left"
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Right side (modified) */}
        <div className="flex-1 bg-background">
          <table className="w-full text-sm font-mono">
            <tbody>
              {rightLines.map((line, index) => (
                <DiffLineRow
                  key={index}
                  line={line}
                  showLineNumbers={showLineNumbers}
                  mode="split-right"
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface DiffLineRowProps {
  line: DiffLine | null;
  showLineNumbers: boolean;
  mode: 'unified' | 'split-left' | 'split-right';
}

function DiffLineRow({ line, showLineNumbers, mode }: DiffLineRowProps) {
  if (!line) {
    // Empty placeholder for split view alignment
    return (
      <tr className="bg-muted/30">
        {showLineNumbers && <td className="px-2 py-0.5 text-muted-foreground select-none w-12" />}
        <td className="px-2 py-0.5 w-4" />
        <td className="px-2 py-0.5 whitespace-pre">&nbsp;</td>
      </tr>
    );
  }

  const lineNumber =
    mode === 'split-left' || mode === 'unified'
      ? line.originalLineNumber
      : line.lineNumber;

  const bgColor =
    line.type === 'added'
      ? 'bg-green-500/10'
      : line.type === 'removed'
        ? 'bg-red-500/10'
        : '';

  const textColor =
    line.type === 'added'
      ? 'text-green-600 dark:text-green-400'
      : line.type === 'removed'
        ? 'text-red-600 dark:text-red-400'
        : '';

  const prefix =
    line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <tr className={bgColor}>
      {showLineNumbers && (
        <td className="px-2 py-0.5 text-muted-foreground select-none w-12 text-right border-r">
          {lineNumber ?? ''}
        </td>
      )}
      <td className={cn('px-2 py-0.5 w-4 select-none', textColor)}>{prefix}</td>
      <td className={cn('px-2 py-0.5 whitespace-pre', textColor)}>{line.content}</td>
    </tr>
  );
}

interface DiffStatsProps {
  diff: DiffResult;
}

function DiffStats({ diff }: DiffStatsProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {diff.addedCount > 0 && (
        <span className="text-green-600 dark:text-green-400">+{diff.addedCount}</span>
      )}
      {diff.removedCount > 0 && (
        <span className="text-red-600 dark:text-red-400">-{diff.removedCount}</span>
      )}
      {diff.addedCount === 0 && diff.removedCount === 0 && (
        <span className="text-muted-foreground">No changes</span>
      )}
    </div>
  );
}

export default DiffViewer;
