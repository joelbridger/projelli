/**
 * AIContextIndicator — "What the AI can see" panel.
 *
 * Workstream D (confidentiality integrity), Phase 0.
 *
 * Shows the user exactly which files are included in the AI context for
 * the next message, and warns when those files span more than one
 * top-level client folder.
 *
 * Design goals:
 *   - Always visible near the chat input (not hidden behind a click).
 *   - Non-blocking: the cross-client warning is informational, not a gate.
 *   - Plain, professional tone — no em dashes, no alarm language.
 *   - Light theme; matches the rest of the app.
 */

import { useMemo } from 'react';
import { Eye, AlertTriangle, FileText } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ExtractedContext } from '@/utils/ai-file-context';
import { detectCrossClientContext, ROOT_LEVEL_SENTINEL } from '@/utils/client-boundary';

export interface AIContextIndicatorProps {
  /** The active file contexts that will be included in the next AI message. */
  openFiles: ExtractedContext[];
  /** Absolute path to the workspace root (from workspaceStore.rootPath). */
  workspaceRoot: string | null | undefined;
  className?: string;
}

/**
 * Format the top-level folder name for display in the warning.
 * The ROOT_LEVEL_SENTINEL is internal; show something cleaner.
 */
function formatFolderName(name: string): string {
  if (name === ROOT_LEVEL_SENTINEL) return 'workspace root';
  return name;
}

export function AIContextIndicator({
  openFiles,
  workspaceRoot,
  className,
}: AIContextIndicatorProps) {
  const filePaths = useMemo(
    () => openFiles.map((f) => f.path),
    [openFiles],
  );

  const crossClient = useMemo(
    () => detectCrossClientContext(filePaths, workspaceRoot),
    [filePaths, workspaceRoot],
  );

  // Nothing in context at all — show a minimal "no files" note.
  if (openFiles.length === 0) {
    return (
      <div
        data-testid="ai-context-indicator"
        data-context-count="0"
        className={cn(
          'flex items-center gap-1.5 text-[11px] text-muted-foreground/60 select-none',
          className,
        )}
      >
        <Eye className="h-3 w-3 shrink-0" aria-hidden />
        <span>No open files in AI context</span>
      </div>
    );
  }

  return (
    <div
      data-testid="ai-context-indicator"
      data-context-count={openFiles.length}
      className={cn('flex flex-col gap-1', className)}
    >
      {/* File list row — always shown */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="ai-context-file-list"
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px] select-none cursor-default',
              crossClient.isCrossClient
                ? 'text-amber-700'
                : 'text-muted-foreground/70',
            )}
          >
            <Eye className="h-3 w-3 shrink-0" aria-hidden />
            <span>
              AI can see{' '}
              <strong className="font-medium">
                {openFiles.length} {openFiles.length === 1 ? 'file' : 'files'}
              </strong>
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent
          data-testid="ai-context-file-tooltip"
          side="top"
          align="start"
          className="max-w-[320px]"
        >
          <div className="space-y-1.5 py-0.5">
            <div className="font-medium text-[11px] mb-1">
              Files included in AI context
            </div>
            <ul className="space-y-0.5">
              {openFiles.map((f) => (
                <li
                  key={f.path}
                  data-testid={`ai-context-file-item-${f.fileName}`}
                  className="flex items-center gap-1.5 text-[11px]"
                >
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate max-w-[260px]" title={f.path}>
                    {f.fileName}
                    {f.truncated && (
                      <span className="ml-1 text-muted-foreground/60">(truncated)</span>
                    )}
                  </span>
                  <span className="ml-auto text-muted-foreground/60 shrink-0">
                    ~{f.tokenEstimate.toLocaleString()} tok
                  </span>
                </li>
              ))}
            </ul>
            {openFiles.length > 0 && (
              <div className="pt-1 border-t border-border/30 text-[10px] text-muted-foreground/70">
                These files are included because they are open in your editor.
                Close a tab to remove it from the AI context.
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Cross-client warning — only shown when files span multiple top-level folders */}
      {crossClient.isCrossClient && (
        <div
          data-testid="ai-context-cross-client-warning"
          className={cn(
            'flex items-start gap-2 rounded border border-amber-300/60',
            'bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800',
          )}
          role="alert"
          aria-live="polite"
        >
          <AlertTriangle
            className="h-3 w-3 mt-0.5 shrink-0 text-amber-600"
            aria-hidden
          />
          <span>
            This chat can see files from more than one top-level folder (
            {crossClient.folders.map(formatFolderName).join(', ')}). If those
            are different clients, double-check before sending.
          </span>
        </div>
      )}
    </div>
  );
}

export default AIContextIndicator;
