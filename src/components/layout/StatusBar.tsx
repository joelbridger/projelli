// Status Bar Component
// Shows workspace info and status indicators

import { useCallback, useMemo, useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { FolderOpen, File, Edit, ChevronRight, Bug } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// M1 (v1.5) Memory: RAG indexer status badge.
import { RagStatusBadge } from '@/components/memory/RagStatusBadge';
import { BugReportDialog } from '@/components/common/BugReportDialog';

/**
 * Extract project name from full path
 * Returns the last folder name, not the full path
 */
function getProjectName(path: string | null): string {
  if (!path) return 'No workspace';
  // Handle both Windows (backslash) and Unix (forward slash) paths
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] || path;
}

/**
 * UX-14: build clickable breadcrumb segments from the active file path,
 * relative to the workspace root.
 *
 * Given:
 *   rootPath  = /Users/jam/my-workspace
 *   filePath  = /Users/jam/my-workspace/docs/guides/test2.txt
 *
 * Emits segments in display order:
 *   [
 *     { label: 'my-workspace', folderPath: '/Users/jam/my-workspace' },
 *     { label: 'docs',         folderPath: '/Users/jam/my-workspace/docs' },
 *     { label: 'guides',       folderPath: '/Users/jam/my-workspace/docs/guides' },
 *   ]
 *
 * The file name itself is rendered separately to its right.
 */
interface BreadcrumbSegment {
  /** Display label (last path component). */
  label: string;
  /** Full absolute folder path to navigate to when clicked. */
  folderPath: string;
}

function buildBreadcrumbs(
  rootPath: string | null,
  filePath: string | null
): BreadcrumbSegment[] {
  if (!rootPath) return [];
  const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const rootSegments = root.split('/').filter(Boolean);
  const rootLabel = rootSegments[rootSegments.length - 1] || root;

  const segments: BreadcrumbSegment[] = [
    { label: rootLabel, folderPath: rootPath },
  ];

  if (!filePath) return segments;

  const file = filePath.replace(/\\/g, '/');
  // Only build ancestors when the file is under the root.
  if (!file.startsWith(root + '/')) return segments;

  // Strip the root prefix + the file name itself, split the middle.
  const relative = file.slice(root.length + 1);
  const relParts = relative.split('/').filter(Boolean);
  // Exclude the last segment (the file name). If there's no intermediate
  // folder, this yields an empty array.
  const folderParts = relParts.slice(0, -1);

  let cursor = rootPath;
  for (const part of folderParts) {
    cursor = `${cursor.replace(/\\/g, '/').replace(/\/+$/, '')}/${part}`;
    segments.push({ label: part, folderPath: cursor });
  }

  return segments;
}

/**
 * UX-14: collapse deeply-nested breadcrumb chains so the status bar doesn't
 * overflow. Keeps the first (root) and the last two entries visible; middle
 * entries are hidden behind a "…" dropdown that restores them on click.
 */
interface DisplayedBreadcrumbs {
  left: BreadcrumbSegment[];
  collapsed: BreadcrumbSegment[];
  right: BreadcrumbSegment[];
}

function collapseBreadcrumbs(
  segments: BreadcrumbSegment[]
): DisplayedBreadcrumbs {
  if (segments.length <= 4) {
    return { left: segments, collapsed: [], right: [] };
  }
  // Keep root + last two; collapse everything in between.
  const firstSegment = segments[0]!;
  const lastTwo = segments.slice(-2);
  const middle = segments.slice(1, -2);
  return {
    left: [firstSegment],
    collapsed: middle,
    right: lastTwo,
  };
}

export function StatusBar() {
  const { rootPath, expandedPaths, setExpandedPaths, selectPath } =
    useWorkspaceStore();
  const { openTabs, activeTabPath } = useEditorStore();
  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const [bugReportOpen, setBugReportOpen] = useState(false);

  const projectName = getProjectName(rootPath);

  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(rootPath, activeTab?.path ?? null),
    [rootPath, activeTab?.path]
  );

  const displayed = useMemo(
    () => collapseBreadcrumbs(breadcrumbs),
    [breadcrumbs]
  );

  /**
   * Navigate the file tree sidebar to a specific folder: expand every
   * ancestor so the folder is visible, then select it. The FileTree
   * component renders the selected state visually.
   */
  const navigateToFolder = useCallback(
    (folderPath: string) => {
      if (!rootPath) return;
      const next = new Set(expandedPaths);
      // Expand every ancestor from root to folderPath inclusive.
      const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const root = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
      if (!normalized.startsWith(root)) return;
      const relative = normalized.slice(root.length);
      const parts = relative.split('/').filter(Boolean);
      let cursor = root;
      next.add(root);
      for (const p of parts) {
        cursor = `${cursor}/${p}`;
        next.add(cursor);
      }
      setExpandedPaths(next);
      selectPath(folderPath);

      // Scroll the selected folder into the sidebar viewport. FileTree
      // renders `aria-selected="true"` on the matching row; grabbing by
      // attribute rather than testid keeps this coupling minimal.
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(
          '[data-testid="file-tree"] [aria-selected="true"]'
        );
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    },
    [rootPath, expandedPaths, setExpandedPaths, selectPath]
  );

  return (
    <div
      data-testid="status-bar"
      className="flex items-center h-6 px-2 border-t bg-card text-xs text-muted-foreground"
    >
      {/* Breadcrumb trail (UX-14). When no file is open we just show the
          workspace name with a folder icon, same as before. */}
      <div
        data-testid="status-bar-project"
        className="flex items-center gap-1 min-w-0"
        title={rootPath || undefined}
      >
        <FolderOpen className="h-3 w-3 flex-shrink-0" />
        {breadcrumbs.length === 0 ? (
          <span
            data-testid="status-bar-project-name"
            className="truncate max-w-[200px]"
          >
            {projectName}
          </span>
        ) : (
          <nav
            data-testid="status-bar-breadcrumbs"
            aria-label="Folder path"
            className="flex items-center gap-0.5 min-w-0"
          >
            {displayed.left.map((seg, i) => (
              <BreadcrumbButton
                key={seg.folderPath}
                segment={seg}
                isFirst={i === 0}
                // Keep the legacy `status-bar-project-name` testid on the
                // first segment so older tests that inspect the workspace
                // name continue to work.
                legacyTestid={i === 0 ? 'status-bar-project-name' : undefined}
                onNavigate={navigateToFolder}
              />
            ))}
            {displayed.collapsed.length > 0 && (
              <>
                <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-testid="status-bar-breadcrumb-collapsed"
                      className="px-1 rounded-sm hover:bg-accent hover:text-accent-foreground"
                      aria-label="Show collapsed path segments"
                    >
                      …
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {displayed.collapsed.map((seg) => (
                      <DropdownMenuItem
                        key={seg.folderPath}
                        data-testid={`status-bar-breadcrumb-collapsed-${seg.label}`}
                        onClick={() => navigateToFolder(seg.folderPath)}
                      >
                        {seg.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {displayed.right.map((seg) => (
              <BreadcrumbButton
                key={seg.folderPath}
                segment={seg}
                isFirst={false}
                onNavigate={navigateToFolder}
              />
            ))}
            {activeTab && (
              <>
                <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60" />
                <span
                  data-testid="status-bar-file-name"
                  className="px-1 truncate max-w-[220px] font-medium text-foreground/80"
                  title={activeTab.name}
                >
                  {activeTab.name}
                </span>
              </>
            )}
          </nav>
        )}
      </div>

      <div className="flex-1" />

      {/* Active file meta — modified indicator only (name is now in the
          breadcrumb trail to its left). */}
      {activeTab && (
        <>
          <div
            data-testid="status-bar-active-file"
            className="flex items-center gap-1 mr-4"
          >
            <File className="h-3 w-3" />
            <span className="truncate max-w-[200px]">{activeTab.name}</span>
          </div>

          {activeTab.isDirty && (
            <div
              data-testid="status-bar-modified"
              className="flex items-center gap-1 text-amber-500"
            >
              <Edit className="h-3 w-3" />
              <span>Modified</span>
            </div>
          )}
        </>
      )}

      {/* M1 (v1.5) Memory: workspace RAG indexer status. */}
      <RagStatusBadge />

      {/* Tab count */}
      <div data-testid="status-bar-tab-count" className="ml-4">
        {openTabs.length} file{openTabs.length !== 1 ? 's' : ''} open
      </div>

      {/* Bug report — opens an in-app dialog that POSTs to the shared
          form-handler service. Storage + email notification happen server
          side; the dialog falls back to a mailto link if the POST fails so
          the user's message is never lost. */}
      <button
        type="button"
        data-testid="status-bar-bug-report"
        className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
        title="Report a bug — sends directly to Jameson"
        onClick={() => setBugReportOpen(true)}
      >
        <Bug className="h-3 w-3" />
        <span>Something broken? Let us know!</span>
      </button>

      <BugReportDialog open={bugReportOpen} onOpenChange={setBugReportOpen} />
    </div>
  );
}

interface BreadcrumbButtonProps {
  segment: BreadcrumbSegment;
  isFirst: boolean;
  /**
   * Optional extra testid that will appear on a wrapping span. Used to
   * preserve the legacy `status-bar-project-name` assertion on the
   * first breadcrumb after the StatusBar refactor.
   */
  legacyTestid?: string | undefined;
  onNavigate: (folderPath: string) => void;
}

function BreadcrumbButton({
  segment,
  isFirst,
  legacyTestid,
  onNavigate,
}: BreadcrumbButtonProps) {
  const button = (
    <button
      type="button"
      data-testid={`status-bar-breadcrumb-${segment.label}`}
      data-breadcrumb-path={segment.folderPath}
      onClick={() => onNavigate(segment.folderPath)}
      className="px-1 truncate max-w-[160px] rounded-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={segment.folderPath}
    >
      {segment.label}
    </button>
  );

  return (
    <>
      {!isFirst && (
        <ChevronRight className="h-3 w-3 flex-shrink-0 opacity-60" />
      )}
      {legacyTestid ? (
        <span data-testid={legacyTestid} className="inline-flex">
          {button}
        </span>
      ) : (
        button
      )}
    </>
  );
}

export default StatusBar;
