// Status Bar Component
// Shows workspace info and status indicators

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { cn } from '@/lib/utils';
import { FolderOpen, File, Edit, ChevronRight, Bug, Briefcase, Globe, ShieldOff } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// M1 (v1.5) Memory: RAG indexer status badge.
import { RagStatusBadge } from '@/components/memory/RagStatusBadge';
// WS-B/C: active-matter (confidentiality scope) indicator.
import { useActiveMatter } from '@/stores/matterStore';
import { matterLabel } from '@/modules/memory/matterResolver';
import { BugReportDialog } from '@/components/common/BugReportDialog';
import { TrialStatusChip } from '@/components/trial';
// WS-C: compact egress mirror — shown when an AI chat is the active tab so the
// "where does this go?" answer is visible even from the status bar.
import { EgressIndicator } from '@/components/privacy/EgressIndicator';
import type { EgressProvider } from '@/modules/privacy/egress';
// Privileged Matter Mode: persistent badge stating network extensions are off.
import { usePrivilegedMatterMode } from '@/hooks/usePrivilegedMatterMode';
// F-120: persistent direct-mode egress signal.
import { useConfidentialityMode } from '@/hooks/useConfidentialityMode';

/**
 * Extract project name from full path
 * Returns the last folder name, not the full path
 */
function getProjectName(path: string | null, fallback: string): string {
  if (!path) return fallback;
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

interface StatusBarProps {
  /** Open the Settings modal (for the License section the trial chip targets). */
  onOpenSettings?: () => void;
}

export function StatusBar({ onOpenSettings }: StatusBarProps = {}) {
  const { t } = useTranslation();
  const { rootPath, expandedPaths, setExpandedPaths, selectPath } =
    useWorkspaceStore();
  const { openTabs, activeTabPath } = useEditorStore();
  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // WS-B/C: which matter the AI is currently confined to (null = all matters).
  const activeMatter = useActiveMatter();
  // Privileged Matter Mode: when active, network plugins + MCP are disabled.
  const privilegedMode = usePrivilegedMatterMode();
  // F-120: persistent confidentiality-mode signal — read here, evaluated after
  // activeChatProvider below so the derived flag can reference it.
  const confidentialityMode = useConfidentialityMode();

  // WS-C: when the active tab is an AI chat, surface the compact egress mirror
  // for that chat's provider. We parse the provider out of the chat file's JSON
  // content (the same field AIChatViewer drives the indicator from), so the
  // status-bar mirror reflects the REAL destination of the next send.
  const activeChatProvider = useMemo<EgressProvider | null>(() => {
    if (!activeTab || !activeTab.path.endsWith('.aichat')) return null;
    try {
      const parsed = JSON.parse(activeTab.content) as { provider?: string };
      return (parsed.provider ?? 'anthropic') as EgressProvider;
    } catch {
      // Unparsed/empty chat file: still an AI chat, default to the app default.
      return 'anthropic';
    }
  }, [activeTab]);

  // F-120: show the persistent indicator when the mode is not local AND no chat
  // tab is already driving an egress indicator (avoids a double-badge).
  // 'anthropic' is used as the display provider when no chat is open — it drives
  // the correct severity/icon for direct and assured modes.
  const showPersistentEgress = !activeChatProvider && confidentialityMode !== 'local-only';

  const projectName = getProjectName(rootPath, t('layout.status-bar.no-workspace'));

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
            aria-label={t('layout.status-bar.folder-path-aria')}
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
                      aria-label={t('layout.status-bar.show-collapsed-aria')}
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

      {/* Right-side cluster. gap-4 gives every segment consistent breathing
          room so nothing feels mashed together (v1.6 rc.6). */}
      <div className="flex items-center gap-4">
        {onOpenSettings && <TrialStatusChip onClick={onOpenSettings} />}

        {activeTab && (
          <>
            <div
              data-testid="status-bar-active-file"
              className="flex items-center gap-1"
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
                <span>{t('layout.status-bar.modified')}</span>
              </div>
            )}
          </>
        )}

        {/* Privileged Matter Mode badge. Persistent and always visible while
            the mode is on, so the user can see at a glance that network
            extensions (network plugins + MCP) are disabled. */}
        {privilegedMode.active && (
          <div
            data-testid="privileged-matter-badge"
            data-trigger={privilegedMode.trigger}
            className="flex items-center gap-1 max-w-[280px] rounded px-1.5 py-0.5 border border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
            title={
              privilegedMode.trigger === 'privileged-matter'
                ? t('privacy.privileged-matter.title-privileged-matter')
                : privilegedMode.trigger === 'local-only'
                  ? t('privacy.privileged-matter.title-local-only')
                  : t('privacy.privileged-matter.title-manual')
            }
          >
            <ShieldOff className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{t('privacy.privileged-matter.badge')}</span>
          </div>
        )}

        {/* WS-C: compact egress mirror. Only rendered when an AI chat is the
            active tab, so the destination is visible from the status bar
            without cluttering it during plain editing. */}
        {activeChatProvider && (
          <EgressIndicator provider={activeChatProvider} variant="compact" />
        )}

        {/* F-120: persistent Direct/Assured egress signal. When no AI chat is
            the active tab, the status bar used to show nothing in Direct mode —
            making it look identical to local-only mode. This ensures the user
            can always see where AI requests would go, even while editing a doc.
            Uses 'anthropic' as the display provider when no chat is open; the
            actual provider is set per-chat and is irrelevant here — the severity
            colour and label come from the mode (direct = sky, assured = indigo). */}
        {showPersistentEgress && (
          <EgressIndicator
            provider="anthropic"
            mode={confidentialityMode}
            variant="compact"
          />
        )}

        {/* WS-B/C: active-matter scope indicator. Always visible so the user
            knows which matter the AI is confined to, even outside a chat. */}
        <div
          data-testid="status-bar-matter"
          data-scope={activeMatter ? 'matter' : 'allMatters'}
          className={cn(
            'flex items-center gap-1 max-w-[200px]',
            activeMatter ? 'text-primary' : 'text-amber-700',
          )}
          title={
            activeMatter
              ? t('matter.scope.active-title', { name: matterLabel(activeMatter) })
              : t('matter.scope.all-matters-title')
          }
        >
          {activeMatter ? (
            <Briefcase className="h-3 w-3 shrink-0" />
          ) : (
            <Globe className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {activeMatter ? matterLabel(activeMatter) : t('matter.scope.all-matters')}
          </span>
        </div>

        <RagStatusBadge />

        <div data-testid="status-bar-tab-count">
          {t('layout.status-bar.tabs-open', { count: openTabs.length })}
        </div>

        <button
          type="button"
          data-testid="status-bar-bug-report"
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          title={t('layout.status-bar.bug-report-title')}
          onClick={() => setBugReportOpen(true)}
        >
          <Bug className="h-3 w-3" />
          <span>{t('layout.status-bar.bug-report-cta')}</span>
        </button>
      </div>

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
