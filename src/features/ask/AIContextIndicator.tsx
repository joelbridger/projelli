/**
 * AIContextIndicator — "What the AI can see" panel.
 *
 * Workstream D (confidentiality integrity), Phase 0 + Phase 1.
 *
 * Phase 0: shows the user which files are in AI context and warns when they
 * span more than one top-level client folder.
 *
 * Phase 1 (D1): adds a "Scope to folder" picker so the user can restrict
 * the chat's context to a single top-level folder without having to close
 * editor tabs manually.
 *
 * Design goals:
 *   - Always visible near the chat input (not hidden behind a click).
 *   - Non-blocking: the cross-client warning is informational, not a gate.
 *   - Plain, professional tone — no em dashes, no alarm language.
 *   - Light theme; matches the rest of the app.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Eye, AlertTriangle, FileText, FolderOpen, ChevronDown, Check } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ExtractedContext } from '@/utils/ai-file-context';
import {
  detectCrossClientContext,
  ROOT_LEVEL_SENTINEL,
  getTopLevelFolderNames,
} from '@/utils/client-boundary';

export interface AIContextIndicatorProps {
  /** The active file contexts that will be included in the next AI message. */
  openFiles: ExtractedContext[];
  /** Absolute path to the workspace root (from workspaceStore.rootPath). */
  workspaceRoot: string | null | undefined;
  /**
   * D1 — the currently active folder scope for this chat.
   * When set, the indicator reflects the scoped file list rather than all
   * open tabs. `null` means no scope is active.
   */
  scopedFolder?: string | null;
  /**
   * D1 — called when the user selects a new scope from the picker.
   * Pass `null` to clear the scope (revert to "All files").
   */
  onScopeChange?: (folder: string | null) => void;
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

/**
 * D1 — Compact folder scope picker. Renders as a lightweight dropdown
 * button that lists every top-level folder visible in the open tabs.
 */
function ScopeFolderPicker({
  allOpenFiles,
  workspaceRoot,
  scopedFolder,
  onScopeChange,
}: {
  allOpenFiles: ExtractedContext[];
  workspaceRoot: string | null | undefined;
  scopedFolder: string | null | undefined;
  onScopeChange: (folder: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when the user clicks outside it.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const allPaths = useMemo(
    () => allOpenFiles.map((f) => f.path),
    [allOpenFiles],
  );

  const topLevelFolders = useMemo(
    () => getTopLevelFolderNames(allPaths, workspaceRoot),
    [allPaths, workspaceRoot],
  );

  // Only show the picker when there is at least one real top-level folder
  // (excluding root-level sentinel — root files don't make a useful scope
  // because they are loose notes rather than client folders).
  const foldersForPicker = useMemo(
    () => topLevelFolders.filter((f) => f !== ROOT_LEVEL_SENTINEL),
    [topLevelFolders],
  );

  // No folders to pick from — don't render the picker.
  if (foldersForPicker.length === 0) return null;

  const label = scopedFolder
    ? scopedFolder.length > 22
      ? `${scopedFolder.slice(0, 20)}...`
      : scopedFolder
    : 'All files';

  return (
    <div
      ref={containerRef}
      data-testid="scope-folder-picker"
      className="relative"
    >
      <button
        type="button"
        data-testid="scope-folder-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] border',
          'select-none cursor-pointer transition-colors',
          scopedFolder
            ? 'border-primary/40 bg-primary/8 text-primary font-medium hover:bg-primary/15'
            : 'border-border/60 text-muted-foreground/70 hover:text-foreground hover:border-border',
        )}
        onClick={() => setOpen((v) => !v)}
        title={
          scopedFolder
            ? `Scoped to folder: ${scopedFolder}. Click to change.`
            : 'Scope this chat to a single folder to keep client data separate.'
        }
      >
        <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
        {label}
        <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          data-testid="scope-folder-dropdown"
          aria-label="Select folder scope"
          className={cn(
            'absolute bottom-full mb-1 left-0 z-50 min-w-[180px] max-w-[280px]',
            'rounded border border-border bg-background shadow-md py-1',
          )}
        >
          {/* "All files" option — clears the scope */}
          <button
            type="button"
            role="option"
            aria-selected={!scopedFolder}
            data-testid="scope-option-all"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left',
              'hover:bg-muted/60 transition-colors',
              !scopedFolder && 'font-medium text-primary',
            )}
            onClick={() => {
              onScopeChange(null);
              setOpen(false);
            }}
          >
            {!scopedFolder && <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden />}
            {scopedFolder && <span className="h-3 w-3 shrink-0" aria-hidden />}
            All files (no scope)
          </button>

          {foldersForPicker.length > 0 && (
            <div className="my-1 border-t border-border/40" role="separator" />
          )}

          {foldersForPicker.map((folder) => (
            <button
              key={folder}
              type="button"
              role="option"
              aria-selected={scopedFolder === folder}
              data-testid={`scope-option-${folder}`}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left',
                'hover:bg-muted/60 transition-colors',
                scopedFolder === folder && 'font-medium text-primary',
              )}
              onClick={() => {
                onScopeChange(folder);
                setOpen(false);
              }}
              title={folder}
            >
              {scopedFolder === folder ? (
                <Check className="h-3 w-3 shrink-0 text-primary" aria-hidden />
              ) : (
                <span className="h-3 w-3 shrink-0" aria-hidden />
              )}
              <span className="truncate">{folder}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AIContextIndicator({
  openFiles,
  workspaceRoot,
  scopedFolder,
  onScopeChange,
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

  // D1 — when a scope is active, the "visible" set is only the scoped files.
  // The Phase 0 cross-client check runs over the *scoped* set so the warning
  // disappears naturally once the user restricts to one folder.
  const visibleFiles = openFiles;
  const visibleCount = visibleFiles.length;

  // Nothing in context at all — still show the scope picker so the user can
  // prepare a scope before opening files.
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
      data-context-count={visibleCount}
      data-scoped-folder={scopedFolder ?? ''}
      className={cn('flex flex-col gap-1', className)}
    >
      {/* File list row + scope picker — always shown */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              data-testid="ai-context-file-list"
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] select-none cursor-default',
                crossClient.isCrossClient && !scopedFolder
                  ? 'text-amber-700'
                  : 'text-muted-foreground/70',
              )}
            >
              <Eye className="h-3 w-3 shrink-0" aria-hidden />
              <span>
                {scopedFolder ? (
                  <>
                    AI sees{' '}
                    <strong className="font-medium">
                      {visibleCount} {visibleCount === 1 ? 'file' : 'files'}
                    </strong>
                    {' '}in{' '}
                    <strong className="font-medium">{scopedFolder}</strong>
                  </>
                ) : (
                  <>
                    AI can see{' '}
                    <strong className="font-medium">
                      {visibleCount} {visibleCount === 1 ? 'file' : 'files'}
                    </strong>
                  </>
                )}
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
                {scopedFolder
                  ? `Files in AI context (scoped to "${scopedFolder}")`
                  : 'Files included in AI context'}
              </div>
              <ul className="space-y-0.5">
                {visibleFiles.map((f) => (
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
              {visibleFiles.length > 0 && (
                <div className="pt-1 border-t border-border/30 text-[10px] text-muted-foreground/70">
                  {scopedFolder
                    ? `Only files inside "${scopedFolder}" are included. Use the scope picker to change.`
                    : 'These files are included because they are open in your editor. Close a tab to remove it from the AI context.'}
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* D1 — scope picker, only when a handler is wired (i.e. not in
            read-only or embedded contexts that don't support scoping). */}
        {onScopeChange && (
          <ScopeFolderPicker
            allOpenFiles={openFiles}
            workspaceRoot={workspaceRoot}
            scopedFolder={scopedFolder}
            onScopeChange={onScopeChange}
          />
        )}
      </div>

      {/* Cross-client warning — only shown when files span multiple top-level
          folders AND no scope is active (a scope inherently limits to one
          folder, so the warning would be redundant and confusing). */}
      {crossClient.isCrossClient && !scopedFolder && (
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
            are different clients, consider scoping the chat or closing the
            extra tabs before sending.
          </span>
        </div>
      )}

      {/* D1 — active scope banner: small confirmation strip so the user
          always knows a filter is in effect. */}
      {scopedFolder && (
        <div
          data-testid="ai-context-scope-active-banner"
          className={cn(
            'flex items-center gap-2 rounded border border-primary/25',
            'bg-primary/5 px-2.5 py-1 text-[11px] text-primary/80',
          )}
        >
          <FolderOpen className="h-3 w-3 shrink-0" aria-hidden />
          <span>
            Context scoped to <strong className="font-medium">{scopedFolder}</strong>. Files
            outside this folder are not shared with the AI.
          </span>
        </div>
      )}
    </div>
  );
}

export default AIContextIndicator;
