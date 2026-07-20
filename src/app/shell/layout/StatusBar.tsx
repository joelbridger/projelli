// Status Bar Component
// Shows workspace info and status indicators

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { isDocxUnsaved, subscribeDocxSaveRegistry, getDocxSaveVersion } from '@/platform/fs/docxSaveRegistry';
import { cn } from '@/lib/utils';
import { FolderOpen, Edit, ChevronRight, Bug, ShieldOff } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useMatters } from '@/platform/matter/matterStore';
import { BugReportDialog } from '@/app/shell/common/BugReportDialog';
import { TrialStatusChip } from '@/features/account/trial';
import { useTrial } from '@/platform/hooks/useTrial';
import { useLicense } from '@/platform/hooks/useLicense';
// Privileged Matter Mode: persistent badge stating network extensions are off.
import { usePrivilegedMatterMode } from '@/platform/hooks/usePrivilegedMatterMode';
// F-120 (VG-5a): live pulse while a provider request is actually in flight.
import { useEgressActivityStore } from '@/platform/privacy/egressActivity';
import { useConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useNativeNetworkLockdownBridgeState } from '@/platform/privacy/nativeNetworkLockdownBridge';
import { Badge } from '@/ui/kp';
import { useSelectionPresentation } from '@/platform/client-context';
import { BRAND } from '@/config/brand';

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
  /**
   * A8.2: whether the editor/Documents surface is the active panel. When false
   * (Search, Email, Workflows, Activity Log, etc.) the file breadcrumb and
   * active-file chip are hidden so the bar never shows stale editor context.
   * Defaults to true so the bar is unchanged for surfaces that don't pass it.
   */
  showFileContext?: boolean;
}

export function StatusBar({ onOpenSettings, showFileContext = true }: StatusBarProps = {}) {
  const { t } = useTranslation();
  const selection = useSelectionPresentation();
  const matters = useMatters();
  // Perf (P1.2): exact-data-only selectors. The old bare `useWorkspaceStore()`
  // / `useEditorStore()` calls subscribed to the ENTIRE store (every field,
  // including ones this bar never reads), so StatusBar re-rendered on any
  // workspace/editor change anywhere in the app — e.g. every keystroke in the
  // active file, since `updateContent` replaces the whole `openTabs` array.
  // Selecting `activeTab` via `.find` returns the SAME tab object reference
  // when a DIFFERENT tab changed, so this only re-renders when the active
  // tab (or the primitives below) actually changes.
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setExpandedPaths = useWorkspaceStore((s) => s.setExpandedPaths);
  const selectPath = useWorkspaceStore((s) => s.selectPath);
  const activeTab = useEditorStore((s) => s.openTabs.find((tab) => tab.path === s.activeTabPath));
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // WS-B/C: which matter the AI is currently confined to (null = all matters).
  const activeMatter = selection.matterId
    ? matters.find((matter) => matter.id === selection.matterId && !matter.archived) ?? null
    : null;
  // The saved choice requests isolation; only native status may claim it is on.
  const privilegedMode = usePrivilegedMatterMode();
  const enforcedNetworkLockdown = useNativeNetworkLockdownBridgeState();
  // F4b: trial state for softened status-bar rendering.
  const trial = useTrial();
  const { isActivated } = useLicense();
  // F-120 (VG-5a): confidentiality mode — used to gate the egress activity pulse.
  const confidentialityMode = useConfidentialityMode();

  // F-120 — active egress pulse: visible while a provider request is in
  // flight, held ~2.5s after the last one so streamed sends don't flicker.
  const egressActiveCount = useEgressActivityStore((s) => s.activeCount);
  const lastEgressAt = useEgressActivityStore((s) => s.lastActivityAt);
  const [pulseHeld, setPulseHeld] = useState(false);
  const pulseVisible = egressActiveCount > 0 || pulseHeld;
  useEffect(() => {
    if (egressActiveCount > 0) {
      // The derived value above paints immediately. Set the hold from a timer
      // so the effect only synchronizes with time and never cascades a render.
      const id = setTimeout(() => { setPulseHeld(true); }, 0);
      return () => { clearTimeout(id); };
    }
    if (!pulseHeld) return undefined;
    const id = setTimeout(() => { setPulseHeld(false); }, 2500);
    return () => { clearTimeout(id); };
  }, [egressActiveCount, lastEgressAt, pulseHeld]);

  // QA-34: re-render when the active .docx's save state changes so the "modified"
  // badge is truthful for a .docx whose save is pending/failing (never a store dirty tab).
  // Declared here (below the egress effect) purely to keep unrelated lines stable.
  useSyncExternalStore(subscribeDocxSaveRegistry, getDocxSaveVersion, getDocxSaveVersion);
  const activeTabModified = !!activeTab && (activeTab.isDirty || isDocxUnsaved(activeTab.path));
  const showTrialInStatus =
    !!onOpenSettings && !isActivated && (trial.isExpired || trial.daysRemaining <= 3);

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
      // Perf (P1.2): read the current expandedPaths here rather than
      // subscribing to it — this callback only ever needs its value at
      // click time, never for rendering, so making it reactive state would
      // just re-render the whole bar every time the file tree sidebar
      // expands/collapses a folder.
      const next = new Set(useWorkspaceStore.getState().expandedPaths);
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
    [rootPath, setExpandedPaths, selectPath]
  );

  return (
    <div
      data-testid="status-bar"
      className="flex items-center h-6 px-2 border-t bg-card text-xs text-muted-foreground"
    >
      {/* Breadcrumb trail (UX-14). Shown only when the Documents/editor surface
          is active (showFileContext=true). On Search, Email, Workflows, etc. the
          breadcrumb is hidden so it does not show stale editor context (A8.2). */}
      <div
        data-testid="status-bar-project"
        className={cn('flex items-center gap-1 min-w-0', !showFileContext && 'hidden')}
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
                        onClick={() => { navigateToFolder(seg.folderPath); }}
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
        {selection.blocked ? (
          <Badge variant="danger" data-testid="status-bar-selection-blocked" aria-label="Client selection blocked">
            BLOCKED
          </Badge>
        ) : null}
        {selection.stale ? (
          <Badge variant="warning" data-testid="status-bar-selection-stale" aria-label="Client selection updating">
            Selection updating
          </Badge>
        ) : null}
        {/* Non-urgent trial details live in the account surface; the status bar
            only keeps urgent trial warnings. */}
        {showTrialInStatus ? (
          <TrialStatusChip onClick={onOpenSettings} />
        ) : null}

        {showFileContext && activeTab && (
          <>
            {activeTabModified && (
              <div
                data-testid="status-bar-modified"
                className="flex items-center gap-1 text-amber-700"
              >
                <Edit className="h-3 w-3" />
                <span>{t('layout.status-bar.modified')}</span>
              </div>
            )}
          </>
        )}

        {/* Privileged Matter Mode badge. Persistent and always visible while
            the mode is on AND there is an active matter (A8: the badge copy
            says "Privileged matter..." so it only makes sense when a matter
            is actually selected). */}
        {enforcedNetworkLockdown.status === 'on' && activeMatter !== null && (
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
            <span className="truncate">Isolated client</span>
          </div>
        )}

        {privilegedMode.active &&
          enforcedNetworkLockdown.status !== 'on' &&
          (enforcedNetworkLockdown.pending || enforcedNetworkLockdown.status === 'unknown') &&
          activeMatter !== null && (
            <div
              data-testid="privileged-matter-badge-unconfirmed"
              className="flex items-center gap-1 max-w-[280px] rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-amber-950"
              title={`${BRAND.name} is checking the desktop privacy guard.`}
            >
              <ShieldOff className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">Checking isolation</span>
            </div>
          )}

        {/* F-120 (VG-5a): live "sending" pulse. Only while a provider request is
            actually in flight. Suppressed in local-only mode. */}
        {pulseVisible && confidentialityMode !== 'local-only' && (
          <span
            data-testid="egress-activity-pulse"
            className="flex items-center gap-1 text-[11px] text-sky-700"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" aria-hidden />
            {t('privacy.egress.sending')}
          </span>
        )}

        {/* Bug report: icon-only to minimise visual noise. */}
        <button
          type="button"
          data-testid="status-bar-bug-report"
          className="text-muted-foreground hover:text-foreground"
          title={t('layout.status-bar.bug-report-title')}
          onClick={() => { setBugReportOpen(true); }}
        >
          <Bug className="h-3 w-3" />
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
      onClick={() => { onNavigate(segment.folderPath); }}
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
