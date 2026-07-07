/**
 * DocumentsHome — R4 redesign: "Files" as a pinned tab.
 *
 * Layout: a single unified tab strip across the top, followed by a single
 * content area. The strip always contains a pinned "Files" tab first, then
 * the open document tabs (from editorStore.openTabs). Clicking "Files" shows
 * the DocumentGridView; clicking any document tab shows it in the editor
 * below the strip.
 *
 * There is NO persistent left-column list and no dual tab bar:
 *   - The "Files" tab is rendered directly here as a single extra chip
 *     before the document tabs.
 *   - MainPanel is rendered with hideTabBar=true so only ONE tab strip exists.
 *
 * Preserved from R3:
 *   - Email-open flow: opening an email still shows it via an editorStore tab.
 *   - "Add files" import affordance + one-time trust note ("Indexed on your
 *     machine. Nothing was uploaded."), remembered via localStorage.
 *   - Trash: accessible via the Files/Trash toggle inside the grid view.
 *   - All prop types are unchanged so App.tsx wiring is unmodified.
 *
 * Empty-tree fix: App.tsx test-mode seeds only `openFile()` calls but never
 * calls `setFileTree()`. The DocumentGridView now also reads openTabs so it
 * can render a synthetic tree derived from the open tabs when the real
 * fileTree is empty. The real fix for production is that every workspace load
 * already calls getFileTree() -> setFileTree() via App.tsx's watcher effect.
 *
 * No Tailwind on layout elements — all styling via inline styles + CSS vars.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from 'react';
import { FolderOpen, FolderTree, FileText, X, Plus, Upload, ListTree, LayoutGrid } from 'lucide-react';
import { IconButton, Callout, Button, SearchField, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useEditorStore } from '@/platform/state/editorStore';
import { isDocxUnsaved, subscribeDocxSaveRegistry, getDocxSaveVersion, closeDocxTabSafely } from '@/platform/fs/docxSaveRegistry';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { getFileIcon } from '@/platform/utils/fileIcons';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import { DocumentGridView } from './DocumentGridView';
import { FileTree } from '@/features/documents/workspace/FileTree';
import { scopeFileTreeToFolders, toAbsolute, toScopedFolderPath } from './scopeFileTree';
import { isPathInFolder } from '@/platform/rag/matterResolver';
import { SK_FIRST_FILE_TRUST_SHOWN, SK_DOCS_VIEW } from '@/config/identity';

// ── Constants ──────────────────────────────────────────────────────────────

const TRUST_STORAGE_KEY = SK_FIRST_FILE_TRUST_SHOWN;
const FILES_TAB_ID = '__files__';

// R6-1: which Files view the user last chose (vertical expanding tree vs the
// folder-drill grid). Persisted so the choice survives reloads.
const DOCS_VIEW_STORAGE_KEY = SK_DOCS_VIEW;
type DocsView = 'tree' | 'grid';

function readDocsView(): DocsView {
  try {
    return localStorage.getItem(DOCS_VIEW_STORAGE_KEY) === 'tree' ? 'tree' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeDocsView(view: DocsView): void {
  try {
    localStorage.setItem(DOCS_VIEW_STORAGE_KEY, view);
  } catch {
    // ignore
  }
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface DocumentsHomeProps {
  /**
   * The full <MainPanel> element passed from App.tsx.
   * Rendered in the content area when a document tab is active.
   * Must be rendered with hideTabBar=true (App.tsx wires this via the prop).
   */
  mainPanelContent: React.ReactNode;
  /**
   * Fix 1: which view to land on. This component UNMOUNTS/REMOUNTS on every tab
   * switch, so App.tsx owns the intent (it persists across the remount) and we
   * read it in the userOnFiles useState initializer on mount. 'browser' => the
   * Files list (nav click, reveal-folder, matter launch); 'editor' => the open
   * document (email/file open). Undefined preserves the legacy default.
   */
  documentsView?: 'browser' | 'editor';
  // Trash handlers
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  retentionPeriod?: TrashRetentionPeriod;
  customRetentionDays?: number;
  onRetentionChange?: (period: TrashRetentionPeriod, customDays?: number) => void;
  // File operation handlers
  onFileOpen: (path: string, name: string) => Promise<unknown>;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload: (path: string, name: string) => void;
  onCreateDefaultDocument?: (parentPath?: string) => void;
  /** BUG-014 — import existing files via the native picker into `folderPath`. */
  onImportFiles?: (folderPath?: string | null) => void | Promise<void>;
  onCreateDocxAtRoot?: (parentPath?: string) => void;
  /**
   * R6-1: the vertical expanding tree view (FileTree) shares the Files surface
   * with the grid via a Tree | Grid toggle. The tree's toolbar offers the same
   * "new at root" creators the sidebar tree does; these are threaded through so
   * the toolbar is fully functional. All are optional — when absent the
   * corresponding toolbar entry simply no-ops, exactly as FileTree allows.
   */
  onCreateTextFileAtRoot?: () => void;
  onCreateFolderAtRoot?: () => void;
  onSetLetterheadTemplate?: (path: string) => void;
  /**
   * Embedded mode — the per-client Documents sub-tab inside the Client Map hub.
   * Hides the standalone "Documents" surface header (the hub already provides
   * the client header) so it reads as a section of the client, not a separate
   * destination.
   */
  embedded?: boolean;
  /**
   * When set, the file browser is scoped to THIS client's folders (the matter's
   * `folderPaths`). The tree + grid show only files under these folders; an
   * empty array means the client has no mapped folders yet (honest empty state).
   * Undefined = the global, full-workspace browser.
   */
  scopeFolderPaths?: string[];
  /**
   * The id of the client being scoped. Combined with the matter list, the prune
   * drops any nested subfolder owned by a DIFFERENT client, so this tab can
   * never surface another client's files (matter isolation).
   */
  scopeMatterId?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const EDITOR_TAB_TYPES = new Set(['file', 'browser', 'email', 'workflow-execution', 'ai-assistant']);

function isEditorSurfaceTab(type: string): boolean {
  return EDITOR_TAB_TYPES.has(type);
}

/**
 * Defensive boundary (2026-07-01 re-fix): coerce a scoped-folders prop to a
 * clean `string[]`. `scopeFolderPaths` is TYPED `string[]` (it comes from
 * `Matter.folderPaths`), but a corrupted/legacy matter can carry a NON-STRING
 * entry — an object that stringifies to the literal `"[object Object]"`. The
 * matter-store migration sanitises persisted data, but this is the
 * belt-and-suspenders guard so such a value can NEVER reach a create/import
 * target (`destDir`) at runtime, where it would create a real garbage folder
 * named `[object Object]`. Returns `undefined` untouched (the unscoped, global
 * browser); a provided-but-dirty array is filtered to real string paths.
 */
function coerceScopeFolderPaths(
  paths: string[] | undefined,
): string[] | undefined {
  if (paths === undefined) return undefined;
  const out: string[] = [];
  for (const value of paths as unknown[]) {
    const raw =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? ((value as { path?: unknown }).path ??
             (value as { folderPath?: unknown }).folderPath)
          : null;
    if (typeof raw === 'string' && raw.trim()) {
      out.push(raw);
    } else if (value != null) {
      console.warn(
        '[DocumentsHome] dropped a non-string scopeFolderPaths entry (would have become "[object Object]"):',
        value,
      );
    }
  }
  return out;
}

function hasTrustBeenShown(): boolean {
  try {
    return localStorage.getItem(TRUST_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markTrustShown(): void {
  try {
    localStorage.setItem(TRUST_STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

// ── Trust banner ──────────────────────────────────────────────────────────

interface TrustBannerProps {
  onDismiss: () => void;
}

function TrustBanner({ onDismiss }: TrustBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="trust-banner"
      style={{
        padding: 'var(--kp-space-xs) var(--kp-gutter)',
        borderBottom: '1px solid var(--kp-divider)',
        flexShrink: 0,
      }}
    >
      <Callout variant="info" icon={FileText} onDismiss={onDismiss}>
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        Indexed on your machine. Nothing was uploaded.
        {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      </Callout>
    </div>
  );
}

// ── Tab strip tab chip ─────────────────────────────────────────────────────

interface TabChipProps {
  label: string;
  isActive: boolean;
  isDirty?: boolean;
  icon?: React.ReactNode;
  isPinned?: boolean;
  onActivate: () => void;
  onClose?: () => void;
}

function TabChip({ label, isActive, isDirty, icon, isPinned, onActivate, onClose }: TabChipProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Shared visual styles for the activatable chip area. The chip is a <button>
  // so keyboard users can Tab to it and press Enter/Space to activate it.
  const chipStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '0 12px',
    height: '100%',
    cursor: 'pointer',
    // borderBottom provides the active-tab underline; border resets the button default.
    // We set border first (shorthand) then override borderBottom so only the bottom
    // active indicator shows.
    border: 'none',
    borderBottom: isActive ? '2px solid var(--kp-navy)' : '2px solid transparent',
    borderRadius: 0,
    outline: 'none',
    background: isActive
      ? 'rgba(10,37,64,0.05)'
      : isHovered
        ? 'rgba(10,37,64,0.02)'
        : 'transparent',
    flexShrink: 0,
    userSelect: 'none',
    transition: 'background 0.1s',
    minWidth: 0,
    maxWidth: onClose ? 176 : 200, // leave room for the close sibling
    position: 'relative',
    fontFamily: 'inherit',
  };

  return (
    // Wrap chip + close button in a containing div so they sit side-by-side
    // inside the flex strip without nesting one button inside another.
    <div
      style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0, position: 'relative', maxWidth: 200 }}
      onMouseEnter={() => { setIsHovered(true); }}
      onMouseLeave={() => { setIsHovered(false); }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        style={chipStyle}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        }}
      >
        {icon && (
          <span style={{ flex: 'none', display: 'flex', alignItems: 'center' }}>{icon}</span>
        )}
        <span
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontWeight: isActive ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
            color: isActive ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
            fontFamily: 'Satoshi, sans-serif',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
            lineHeight: 'var(--kp-leading-tight)',
          }}
        >
          {label}
        </span>
        {isDirty && !onClose && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--kp-navy)',
              opacity: 0.5,
              flex: 'none',
            }}
          />
        )}
      </button>
      {!isPinned && onClose && (
        // Close button is a sibling of the tab button, not a child, to avoid
        // nesting interactive elements (button-in-button is invalid HTML).
        <IconButton
          icon={X}
          label={`Close ${label}`}
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            alignSelf: 'center',
            marginRight: 4,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
        />
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function DocumentsHome({
  mainPanelContent,
  documentsView,
  trashItems,
  trashStats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod,
  customRetentionDays,
  onRetentionChange,
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  onCreateDefaultDocument,
  onImportFiles,
  onCreateDocxAtRoot,
  onCreateTextFileAtRoot,
  onCreateFolderAtRoot,
  onSetLetterheadTemplate,
  embedded = false,
  scopeFolderPaths,
  scopeMatterId,
}: DocumentsHomeProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  // QA-34: re-render this tab strip when any .docx's save state changes so a
  // tab chip's unsaved dot is truthful for a .docx whose save is pending/failing
  // (its store tab is never dirty). Data-loss on close is handled by the shared
  // flushTabForClose hook; this is the matching visual truthfulness.
  useSyncExternalStore(subscribeDocxSaveRegistry, getDocxSaveVersion, getDocxSaveVersion);
  // QA-34: in-app confirm for the rare "the .docx couldn't be saved on close"
  // case (native window.confirm is dead in the WebView2 build).
  const { confirm: confirmClose, dialogProps: closeConfirmDialogProps } = useConfirmDialog();
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const storeFileTree = useWorkspaceStore((s) => s.fileTree);
  // Used (only when scoping) to drop nested foreign-client folders from the tree.
  const matters = useMatterStore((s) => s.matters);

  // Defensive boundary: sanitise the scoped-folders prop to clean strings ONCE
  // so no `[object Object]` can leak into the tree prune, the scope check, or a
  // create/import target below. Every internal use reads `safeScopeFolderPaths`,
  // never the raw prop. `undefined` (the unscoped global browser) is preserved.
  const safeScopeFolderPaths = useMemo(
    () => coerceScopeFolderPaths(scopeFolderPaths),
    [scopeFolderPaths],
  );

  // Per-client scoping: when `scopeFolderPaths` is provided, prune the workspace
  // tree to just this client's folders — and, with the matter list + id, drop
  // any subfolder owned by another client — then feed that pruned tree to both
  // the grid and the tree views. Pure + memoized so the global store tree is
  // never mutated and we don't reprune on every render.
  const scopedFileTree = useMemo(
    () =>
      safeScopeFolderPaths
        ? scopeFileTreeToFolders(storeFileTree, safeScopeFolderPaths, matters, scopeMatterId, rootPath)
        : undefined,
    [safeScopeFolderPaths, storeFileTree, matters, scopeMatterId, rootPath],
  );

  // Trust banner state
  const [showTrustBanner, setShowTrustBanner] = useState(false);

  // R6-1: Tree | Grid toggle for the Files surface. Restored from localStorage.
  const [docsView, setDocsView] = useState<DocsView>(() => readDocsView());
  const handleSetDocsView = useCallback((view: DocsView) => {
    setDocsView(view);
    writeDocsView(view);
  }, []);

  // Lifted from DocumentGridView: Files/Trash toggle and search query.
  // These live here so the toolbar can be rendered above the tab strip.
  const [activeView, setActiveView] = useState<'files' | 'trash'>('files');
  const [searchQuery, setSearchQuery] = useState('');

  // "userOnFiles" tracks whether the user explicitly clicked the "Files" tab.
  // When false, the active document tab in editorStore drives what is shown.
  // When a new editor-surface tab becomes active externally (email-open flow,
  // AI shortcut, grid card click), we flip back to false via a ref — no setState inside an effect.
  // Initialize from documentsView on mount. Because this component remounts on
  // every nav, the useState initializer is the reliable place to honor the
  // intent: 'browser' => show the Files list; 'editor'/undefined => editor
  // (legacy default when the prop is absent in tests/browser).
  // Embedded (per-client) lands on the scoped file list by default. When Ask
  // has just saved a document and explicitly sets documentsView='editor', open
  // the new file instead of forcing the user back to the list.
  const initialOnFiles = embedded ? documentsView !== 'editor' : documentsView === 'browser';
  const [userOnFiles, setUserOnFiles] = useState(initialOnFiles);
  // Ref that shadows userOnFiles so we can read it synchronously in the effect
  // without capturing a stale closure.
  const userOnFilesRef = useRef(initialOnFiles);

  // Track the last editor-surface path the store told us about; when it changes
  // externally, flip userOnFiles off via a ref comparison (no setState in the
  // effect body — we apply it on the NEXT render via queueMicrotask).
  // Seed with the mount-time active path so the effect does NOT treat the
  // already-open tab as a "newly opened" file (which would yank a nav-click
  // landing on the browser straight into the editor).
  const prevActivePathRef = useRef<string | null>(activeTabPath ?? null);

  useEffect(() => {
    if (activeTabPath === null) return;
    const matchingTab = openTabs.find((t) => t.path === activeTabPath);
    if (!matchingTab) return;
    if (!isEditorSurfaceTab(matchingTab.type ?? 'file')) return;
    if (prevActivePathRef.current === activeTabPath) return;
    prevActivePathRef.current = activeTabPath;
    // An editor-surface tab became active externally: navigate away from the Files
    // grid to show the editor. Use queueMicrotask so the setState is deferred
    // out of the effect synchronous execution (satisfies react-hooks/set-state-in-effect).
    if (userOnFilesRef.current) {
      queueMicrotask(() => {
        setUserOnFiles(false);
        userOnFilesRef.current = false;
      });
    }
  }, [activeTabPath, openTabs]);

  // Fix 1 (while-mounted): the useState initializer already honors documentsView
  // on mount (the common case, since this component remounts on every nav). This
  // effect handles the rarer case where documentsView changes WHILE Documents is
  // already mounted (e.g. an email opens while you're on the Files browser). It
  // seeds prevDocumentsViewRef to the mount value so it does not re-fire for the
  // mount itself, only for genuine changes.
  const prevDocumentsViewRef = useRef<'browser' | 'editor' | undefined>(documentsView);
  useEffect(() => {
    if (documentsView === undefined) return;
    if (documentsView === prevDocumentsViewRef.current) return;
    prevDocumentsViewRef.current = documentsView;
    const wantBrowser = documentsView === 'browser';
    userOnFilesRef.current = wantBrowser;
    // queueMicrotask to stay consistent with the external-tab-change effect
    // above (same rule: no synchronous setState inside the effect body).
    queueMicrotask(() => {
      setUserOnFiles(wantBrowser);
    });
  }, [documentsView]);

  // ── Tab handlers ─────────────────────────────────────────────────────────

  const handleTabActivate = useCallback(
    (tabPath: string) => {
      if (tabPath === FILES_TAB_ID) {
        userOnFilesRef.current = true;
        setUserOnFiles(true);
      } else {
        userOnFilesRef.current = false;
        setUserOnFiles(false);
        setActiveTab(tabPath);
      }
    },
    [setActiveTab],
  );

  const handleTabClose = useCallback(
    async (tabPath: string) => {
      const wasActive = tabPath === activeTabPath;
      // QA-34: for a .docx, save first (editor still mounted) and only ask to
      // discard if the save fails — a locked file can never silently lose the doc
      // on close. Non-.docx tabs use the normal close (autosave already flushed).
      const handled = await closeDocxTabSafely(tabPath, {
        closeTab,
        confirmDiscardOnFailure: () =>
          confirmClose(
            `I couldn't save this document — another program may be blocking the file. ` +
              `Close anyway and lose your latest changes?`,
            {
              title: 'Unsaved changes',
              variant: 'destructive',
              confirmLabel: 'Close and lose changes',
              cancelLabel: 'Keep open',
            },
          ),
      });
      if (!handled) closeTab(tabPath);
      // If the tab actually closed and it was active with nothing left, go to Files.
      const stillOpen = useEditorStore
        .getState()
        .openTabs.some((t) => t.path === tabPath);
      if (!stillOpen && wasActive) {
        const remaining = useEditorStore
          .getState()
          .openTabs.filter((t) => isEditorSurfaceTab(t.type ?? 'file'));
        if (remaining.length === 0) {
          userOnFilesRef.current = true;
          setUserOnFiles(true);
        }
      }
    },
    [closeTab, activeTabPath, confirmClose, setUserOnFiles],
  );

  // ── Toolbar folder state ──────────────────────────────────────────────────
  // The drilled-into folder (null = root), lifted from DocumentGridView so the
  // toolbar's create/import buttons land items in the folder you're viewing.
  // When embedded as a per-client tab, default into the client's mapped folder
  // so New document / New folder / Add files land INSIDE the client rather than
  // at the workspace root, where they'd immediately vanish from this scoped
  // view (Codex review P2). This component remounts on each sub-tab open, so the
  // initializer reliably re-seeds the target each time.
  // BUG (2026-07-01): `scopeFolderPaths` is ABSOLUTE (Matter.folderPaths shape)
  // while `scopedFileTree` node paths preserve whatever shape the store tree
  // used (workspace-RELATIVE in production). Seeding this state with the raw
  // absolute path meant DocumentGridView's `node.path === currentFolderPath`
  // lookup never matched, so the Grid view (the default view) rendered empty
  // even though the scoped tree had files — Tree view worked because it
  // renders the tree directly. `toScopedFolderPath` bridges the two shapes by
  // finding the actual matching node in `scopedFileTree` (null = the scoped
  // root).
  // Codex review (round 2): if this embedded tab mounts before `storeFileTree`
  // has loaded (e.g. landing directly on a client's Documents tab on first
  // app load), the initializer below resolves against an EMPTY tree and gets
  // stuck at the scoped root forever — `toScopedFolderPath` never gets a
  // second chance once useState's initializer has run once. `hasSettledScopedFolder`
  // tracks whether we've already resolved against a REAL (non-empty) tree.
  // Re-resolving is done via React's "adjusting state during render" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect) rather than a
  // useEffect, so it fires exactly once when the tree arrives and never
  // touches `currentFolderPath` again afterwards — a later tree refresh (e.g.
  // the file watcher's periodic poll) can't clobber the user's own subsequent
  // navigation.
  const [hasSettledScopedFolder, setHasSettledScopedFolder] = useState(() => storeFileTree.length > 0);
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(() => {
    const firstScopeFolder = embedded ? safeScopeFolderPaths?.[0] : undefined;
    return firstScopeFolder ? toScopedFolderPath(scopedFileTree ?? [], firstScopeFolder, rootPath) : null;
  });

  if (!hasSettledScopedFolder && storeFileTree.length > 0) {
    setHasSettledScopedFolder(true);
    const firstScopeFolder = embedded ? safeScopeFolderPaths?.[0] : undefined;
    if (firstScopeFolder) {
      setCurrentFolderPath(toScopedFolderPath(scopedFileTree ?? [], firstScopeFolder, rootPath));
    }
  }

  // `currentFolderPath` matches the (possibly tree-relative) shape needed for
  // grid/breadcrumb lookups — see `toScopedFolderPath` above. A create/import
  // target must instead be disk-resolvable on its own: `onImportFiles`'s copy
  // goes through `WorkspaceService` (which resolves relative-or-absolute), but
  // its explicit `MemoryService.indexFile` call sends the SAME path straight to
  // the Rust indexer with no workspace-root joining — a relative target there
  // silently fails to index (Codex review). Normalize back to absolute before
  // using it as a create/import target, independent of the lookup shape.
  //
  // Codex review (P1): the scoped tree deliberately keeps ANCESTOR folders
  // (e.g. "Clients") so the client's mapped folder is reachable via
  // breadcrumbs — fixing the Grid-empty bug made that navigation actually
  // reachable for the first time. Without this guard, navigating to such an
  // ancestor and clicking "New document"/"Add files" would create the file
  // OUTSIDE the client's own folder (a matter-isolation leak: it vanishes
  // from this scoped view and is never assigned to the client). Clamp: a
  // resolved target that isn't itself inside one of the client's OWN mapped
  // folders is treated as out-of-scope, falling back to `embeddedCreateFallback`
  // below — exactly like the existing root (`currentFolderPath === null`) clamp.
  // Shared by createTargetPath below AND scopedOnMove (drag-and-drop) — both
  // need the same "is this absolute path actually inside the client's own
  // scope" check, not just "does the app consider it embedded".
  const isWithinEmbeddedScope = useCallback(
    (absPath: string): boolean => {
      if (!embedded || !safeScopeFolderPaths || safeScopeFolderPaths.length === 0) return true;
      return safeScopeFolderPaths.some((folder) => isPathInFolder(absPath, folder));
    },
    [embedded, safeScopeFolderPaths],
  );

  const createTargetPath = (() => {
    if (currentFolderPath === null) return null;
    const abs = toAbsolute(currentFolderPath, rootPath);
    if (!isWithinEmbeddedScope(abs)) return null;
    return abs;
  })();

  // Codex review (P1, round 4): drag-and-drop onto an ancestor breadcrumb
  // (e.g. dropping a file onto "Clients") is now reachable for the same
  // reason as above — it must be blocked the same way, or a drag can move a
  // client's file OUT of their own matter-isolated folder entirely (it then
  // belongs to no client, or a different one, and vanishes from this
  // client's Documents tab). Fails closed: an out-of-scope drop is a silent
  // no-op, consistent with this file's other guarded-drop no-ops (dropping
  // onto self/already-parent/descendant).
  const scopedOnMove = useCallback(
    async (sourcePath: string, targetPath: string) => {
      if (!isWithinEmbeddedScope(toAbsolute(targetPath, rootPath))) return;
      await onMove(sourcePath, targetPath);
    },
    [onMove, isWithinEmbeddedScope, rootPath],
  );

  // Embedded (per-client): clamp only the create/import TARGET — not navigation.
  // At the scoped root (currentFolderPath === null, e.g. the "All files"
  // breadcrumb) New document / Add files would otherwise fall back to the GLOBAL
  // workspace; this fallback keeps them inside the client's own folder (matter
  // isolation). Navigation is deliberately left free (null = scoped root) so a
  // client with MULTIPLE mapped folders can still reach the root + its sibling
  // folders (Codex P2 — clamping navigation made those unreachable).
  const embeddedCreateFallback =
    embedded && safeScopeFolderPaths && safeScopeFolderPaths.length > 0
      ? (safeScopeFolderPaths[0] ?? null)
      : null;

  // ── Add-files / trust-note logic ─────────────────────────────────────────

  // BUG-014 — "Add files" now IMPORTS existing files (it previously, wrongly,
  // opened the New-Document dialog — there was no import at all). The native
  // picker → copy into the current folder → index runs in `onImportFiles`.
  // Falls back to creating a document only when no import handler is wired
  // (e.g. the browser/test build with no native picker).
  const handleAddFiles = useCallback(() => {
    if (!hasTrustBeenShown()) {
      setShowTrustBanner(true);
      markTrustShown();
    }
    // Every branch routes through the embedded fallback so a root-level create
    // in the per-client tab lands in the client's folder, never the global
    // workspace (matter isolation) — regardless of which create handler a parent
    // wired up.
    const target = createTargetPath ?? embeddedCreateFallback ?? undefined;
    if (onImportFiles) {
      void onImportFiles(target);
    } else if (onCreateDefaultDocument) {
      onCreateDefaultDocument(target);
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot(target);
    } else {
      onCreateFile(target ?? '');
    }
  }, [onImportFiles, createTargetPath, embeddedCreateFallback, onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleDismissTrust = useCallback(() => {
    setShowTrustBanner(false);
  }, []);

  // ── Toolbar action handlers (lifted from DocumentGridView) ────────────────

  const handleCreateDocument = useCallback(() => {
    const parentPath = createTargetPath ?? embeddedCreateFallback ?? undefined;
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument(parentPath);
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot(parentPath);
    } else {
      // Route the generic create through the embedded fallback too, so a
      // root-level "New document" in the per-client tab can't write to the
      // global workspace (matter isolation).
      onCreateFile(parentPath ?? '');
    }
  }, [createTargetPath, embeddedCreateFallback, onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(createTargetPath ?? embeddedCreateFallback ?? rootPath ?? '');
  }, [createTargetPath, embeddedCreateFallback, rootPath, onCreateFolder]);

  const trashBadgeCount = trashStats.itemCount;

  // ── Derived content state ────────────────────────────────────────────────

  // Only tabs that MainPanel can render in the Documents surface appear here.
  const visibleTabs = openTabs.filter((t) => isEditorSurfaceTab(t.type ?? 'file'));

  // Show the grid when: user explicitly clicked Files, OR no editor-surface tabs exist.
  const showFilesGrid = userOnFiles || visibleTabs.length === 0;

  // The "selected" tab path for highlight purposes in the strip.
  const selectedTab = showFilesGrid ? FILES_TAB_ID : (activeTabPath ?? FILES_TAB_ID);

  // ── Tab icon helper ──────────────────────────────────────────────────────

  function getTabIcon(tab: { name: string; type?: string }) {
    if (tab.type === 'email') {
      return <FileText style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--kp-navy)', strokeWidth: 2 }} />;
    }
    const ext = tab.name.split('.').pop()?.toLowerCase();
    const { Icon, color } = getFileIcon(ext);
    const colorMap: Record<string, string> = {
      'text-zinc-500': '#71717a',
      'text-blue-500': '#3b82f6',
      'text-red-500': '#ef4444',
      'text-green-500': '#22c55e',
      'text-indigo-500': '#6366f1',
      'text-amber-700': '#b45309',
      'text-sky-500': '#0ea5e9',
      'text-purple-500': '#a855f7',
      'text-pink-500': '#ec4899',
      'text-orange-500': '#f97316',
    };
    const cssColor = colorMap[color] ?? 'var(--color-muted-foreground)';
    return <Icon style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: cssColor, strokeWidth: 1.75 }} />;
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="documents-split"
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
      {/* Page header — hidden when embedded as a per-client sub-tab (the hub
          already shows the client header above the sub-tab bar). */}
      {!embedded && (
        <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)', flexShrink: 0 }}>
          <SurfaceHeader
            Icon={FolderTree}
            title="Documents"
          />
        </div>
      )}

      {/* ── Files toolbar — stays visible above the tab strip even while a document is open. */}
      <SurfaceToolbar data-testid="documents-toolbar">
          {/* eslint-disable lantern-i18n/no-hardcoded-string */}

          {/* 1. Action buttons — files view only */}
          {activeView === 'files' && (
            <>
              <Button variant="primary" size="md" iconLeft={Plus} onClick={handleCreateDocument}>
                New document
              </Button>
              <Button variant="secondary" size="md" iconLeft={Plus} onClick={handleCreateFolder}>
                New folder
              </Button>
              <Button
                variant="secondary"
                size="md"
                iconLeft={Upload}
                data-testid="add-files-btn"
                onClick={handleAddFiles}
              >
                Add files
              </Button>
            </>
          )}

          {/* 2. Toggles: Files/Trash + Tree/Grid (files view only). Trash is a
              GLOBAL, cross-client surface (you could see/restore/permanently-
              delete other clients' deleted files), so the Files/Trash toggle is
              hidden in the per-client embedded tab — it shows only this client's
              live files (matter isolation). */}
          {!embedded && (
          <div
            className="kp-segmented kp-segmented--md"
            role="group"
            aria-label="View files or trash"
          >
            <button
              type="button"
              data-testid="docs-files-toggle"
              className={`kp-segmented__item${activeView === 'files' ? ' is-active' : ''}`}
              aria-pressed={activeView === 'files'}
              onClick={() => { setActiveView('files'); }}
            >
              Files
            </button>
            <button
              type="button"
              data-testid="docs-trash-toggle"
              className={`kp-segmented__item${activeView === 'trash' ? ' is-active' : ''}`}
              aria-pressed={activeView === 'trash'}
              onClick={() => { setActiveView('trash'); }}
            >
              Trash
              {trashBadgeCount > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    fontSize: 'var(--kp-font-2xs)',
                    fontWeight: 'var(--kp-weight-bold)',
                    background:
                      activeView === 'trash'
                        ? 'rgba(255,255,255,0.25)'
                        : 'rgba(10,37,64,0.12)',
                    color: activeView === 'trash' ? '#fff' : 'var(--kp-navy)',
                    padding: '0 4px',
                    marginLeft: 4,
                  }}
                >
                  {String(trashBadgeCount)}
                </span>
              )}
            </button>
          </div>
          )}

          {/* Tree | Grid view toggle — files view only */}
          {activeView === 'files' && (
            <div
              className="kp-segmented kp-segmented--md"
              role="group"
              aria-label="View"
              data-testid="docs-view-toggle"
              style={{ flex: 'none' }}
            >
              <button
                type="button"
                data-testid="docs-view-tree"
                className={`kp-segmented__item${docsView === 'tree' ? ' is-active' : ''}`}
                aria-pressed={docsView === 'tree'}
                onClick={() => { handleSetDocsView('tree'); }}
              >
                <ListTree size={12} strokeWidth={1.75} />
                Tree
              </button>
              <button
                type="button"
                data-testid="docs-view-grid"
                className={`kp-segmented__item${docsView === 'grid' ? ' is-active' : ''}`}
                aria-pressed={docsView === 'grid'}
                onClick={() => { handleSetDocsView('grid'); }}
              >
                <LayoutGrid size={12} strokeWidth={1.75} />
                Grid
              </button>
            </div>
          )}

          {/* 4. Search — last, grows to fill, files view only */}
          {activeView === 'files' && (
            <SearchField
              data-testid="documents-search-field"
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => { setSearchQuery(''); }}
              placeholder="Search files..."
              size="md"
              style={{ flex: 1, minWidth: 240 }}
            />
          )}

          {/* eslint-enable lantern-i18n/no-hardcoded-string */}
      </SurfaceToolbar>

      {/* ── Unified tab strip ──────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Documents tabs"
        data-testid="documents-tab-strip"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: 38,
          borderBottom: '1px solid var(--kp-divider)',
          background: 'var(--color-background)',
          flexShrink: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollbarWidth: 'none',
        }}
      >
        {/* Pinned "Files" tab — always first */}
        <TabChip
          label="Files"
          isActive={selectedTab === FILES_TAB_ID}
          isPinned
          icon={
            <FolderOpen
              style={{
                width: 'var(--kp-icon-sm)',
                height: 'var(--kp-icon-sm)',
                color:
                  selectedTab === FILES_TAB_ID
                    ? 'var(--kp-navy)'
                    : 'var(--color-muted-foreground)',
                strokeWidth: 2,
              }}
            />
          }
          onActivate={() => { handleTabActivate(FILES_TAB_ID); }}
        />

        {/* Document tabs are the GLOBAL editor tabs (one editor across the app),
            so a foreign client's open file could appear here. In the per-client
            embedded tab they are hidden entirely — the strip keeps only the
            pinned "Files" tab (back to the scoped list); navigation is the
            scoped file tree + opening a scoped file (matter isolation). */}
        {!embedded && (
          <>
            {/* Separator after Files tab when docs are open */}
            {visibleTabs.length > 0 && (
              <div
                style={{
                  width: 1,
                  background: 'var(--color-border)',
                  margin: '8px 2px',
                  flexShrink: 0,
                }}
              />
            )}

            {/* Document tabs */}
            {visibleTabs.map((tab) => (
              <TabChip
                key={tab.path}
                label={tab.name}
                isActive={selectedTab === tab.path}
                isDirty={tab.isDirty || isDocxUnsaved(tab.path)}
                icon={getTabIcon(tab)}
                onActivate={() => { handleTabActivate(tab.path); }}
                onClose={() => { void handleTabClose(tab.path); }}
              />
            ))}
          </>
        )}
      </div>

      {/* Trust banner — one-time, dismissible */}
      {showTrustBanner && (
        <TrustBanner onDismiss={handleDismissTrust} />
      )}

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div
        data-testid={showFilesGrid ? 'documents-right-panel' : 'documents-editor-pane'}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {showFilesGrid ? (
          /* Files surface — the unified toolbar (with Tree|Grid toggle) + body. */
          <DocumentGridView
            onFileOpen={onFileOpen}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRename={onRename}
            onDelete={onDelete}
            onMove={scopedOnMove}
            onDownload={onDownload}
            activeView={embedded ? 'files' : activeView}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            trashItems={trashItems}
            trashStats={trashStats}
            onRestore={onRestore}
            onPermanentDelete={onPermanentDelete}
            onEmptyTrash={onEmptyTrash}
            docsView={docsView}
            currentFolderPath={currentFolderPath}
            onSetCurrentFolderPath={setCurrentFolderPath}
            {...(embeddedCreateFallback ? { createFolderFallback: embeddedCreateFallback } : {})}
            {...(scopedFileTree !== undefined ? { scopedFileTree } : {})}
            {...(embedded && safeScopeFolderPaths ? { scopeRootFolderPaths: safeScopeFolderPaths } : {})}
            treeView={
              <FileTree
                hideToolbar
                {...(scopedFileTree !== undefined ? { fileTreeOverride: scopedFileTree } : {})}
                onFileOpen={onFileOpen}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onRename={onRename}
                onDelete={onDelete}
                onMove={scopedOnMove}
                onDownload={onDownload}
                {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
                {...(onCreateTextFileAtRoot !== undefined ? { onCreateTextFileAtRoot } : {})}
                {...(onCreateFolderAtRoot !== undefined ? { onCreateFolderAtRoot } : {})}
                {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
                {...(onSetLetterheadTemplate !== undefined ? { onSetLetterheadTemplate } : {})}
              />
            }
            {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
            {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
            {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
            {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
            {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
          />
        ) : (
          /* Editor — shown when a document tab is active.
             mainPanelContent already has hideTabBar=true wired in App.tsx. */
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {mainPanelContent}
          </div>
        )}
      </div>
      {/* QA-34: confirm shown only when a .docx couldn't be saved on close. */}
      <ConfirmDialog {...closeConfirmDialogProps} />
    </div>
  );
}
