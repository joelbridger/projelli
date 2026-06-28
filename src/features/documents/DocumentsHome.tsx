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

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, FolderTree, FileText, X, Plus, Upload, ListTree, LayoutGrid } from 'lucide-react';
import { IconButton, Callout, Button, SearchField, SurfaceToolbar } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useEditorStore } from '@/platform/state/editorStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { getFileIcon } from '@/platform/utils/fileIcons';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import { DocumentGridView } from './DocumentGridView';
import { FileTree } from '@/features/documents/workspace/FileTree';
import { scopeFileTreeToFolders } from './scopeFileTree';

// ── Constants ──────────────────────────────────────────────────────────────

const TRUST_STORAGE_KEY = 'keepance:first-file-trust-shown';
const FILES_TAB_ID = '__files__';

// R6-1: which Files view the user last chose (vertical expanding tree vs the
// folder-drill grid). Persisted so the choice survives reloads.
const DOCS_VIEW_STORAGE_KEY = 'keepance:docs-view';
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
  onFileOpen: (path: string, name: string) => Promise<void>;
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
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    >
      <Callout variant="info" icon={FileText} onDismiss={onDismiss}>
        {/* eslint-disable keepance-i18n/no-hardcoded-string */}
        Indexed on your machine. Nothing was uploaded.
        {/* eslint-enable keepance-i18n/no-hardcoded-string */}
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
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const storeFileTree = useWorkspaceStore((s) => s.fileTree);
  // Used (only when scoping) to drop nested foreign-client folders from the tree.
  const matters = useMatterStore((s) => s.matters);

  // Per-client scoping: when `scopeFolderPaths` is provided, prune the workspace
  // tree to just this client's folders — and, with the matter list + id, drop
  // any subfolder owned by another client — then feed that pruned tree to both
  // the grid and the tree views. Pure + memoized so the global store tree is
  // never mutated and we don't reprune on every render.
  const scopedFileTree = useMemo(
    () =>
      scopeFolderPaths
        ? scopeFileTreeToFolders(storeFileTree, scopeFolderPaths, matters, scopeMatterId)
        : undefined,
    [scopeFolderPaths, storeFileTree, matters, scopeMatterId],
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
  // Embedded (per-client) ALWAYS lands on the scoped file list, never a stale
  // editor pane that could be showing another client's open file (matter
  // isolation). This forces only the INITIAL state; later file-open transitions
  // (documentsView -> 'editor', or an editor-surface tab becoming active) still
  // flip to the editor in place via the effects below.
  const initialOnFiles = embedded || documentsView === 'browser';
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
    (tabPath: string) => {
      closeTab(tabPath);
      // If we just closed the active tab and there's nothing left, go to Files.
      if (tabPath === activeTabPath) {
        const remaining = openTabs.filter(
          (t) => t.path !== tabPath && isEditorSurfaceTab(t.type ?? 'file'),
        );
        if (remaining.length === 0) {
          userOnFilesRef.current = true;
          setUserOnFiles(true);
        }
      }
    },
    [closeTab, activeTabPath, openTabs],
  );

  // ── Toolbar folder state ──────────────────────────────────────────────────
  // The drilled-into folder (null = root), lifted from DocumentGridView so the
  // toolbar's create/import buttons land items in the folder you're viewing.
  // When embedded as a per-client tab, default into the client's mapped folder
  // so New document / New folder / Add files land INSIDE the client rather than
  // at the workspace root, where they'd immediately vanish from this scoped
  // view (Codex review P2). This component remounts on each sub-tab open, so the
  // initializer reliably re-seeds the target each time.
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(
    () => (embedded && scopeFolderPaths && scopeFolderPaths.length > 0 ? scopeFolderPaths[0]! : null),
  );

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
    if (onImportFiles) {
      void onImportFiles(currentFolderPath);
    } else if (onCreateDefaultDocument) {
      onCreateDefaultDocument();
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot();
    } else {
      onCreateFile('');
    }
  }, [onImportFiles, currentFolderPath, onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleDismissTrust = useCallback(() => {
    setShowTrustBanner(false);
  }, []);

  // ── Toolbar action handlers (lifted from DocumentGridView) ────────────────

  const handleCreateDocument = useCallback(() => {
    const parentPath = currentFolderPath ?? undefined;
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument(parentPath);
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot(parentPath);
    } else {
      onCreateFile(currentFolderPath ?? '');
    }
  }, [currentFolderPath, onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleCreateFolder = useCallback(() => {
    onCreateFolder(currentFolderPath ?? rootPath ?? '');
  }, [currentFolderPath, rootPath, onCreateFolder]);

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
        <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <SurfaceHeader
            Icon={FolderTree}
            title="Documents"
            description="Your files and folders, on your computer."
          />
        </div>
      )}

      {/* ── Files toolbar — shown above the tab strip when Files tab is active */}
      {showFilesGrid && (
        <SurfaceToolbar data-testid="documents-toolbar">
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}

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

          {/* 2. Toggles: Files/Trash (always shown) + Tree/Grid (files view only) */}
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

          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </SurfaceToolbar>
      )}

      {/* ── Unified tab strip ──────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Documents tabs"
        data-testid="documents-tab-strip"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          height: 38,
          borderBottom: '1px solid var(--color-border)',
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
            isDirty={tab.isDirty}
            icon={getTabIcon(tab)}
            onActivate={() => { handleTabActivate(tab.path); }}
            onClose={() => { handleTabClose(tab.path); }}
          />
        ))}
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
            onMove={onMove}
            onDownload={onDownload}
            activeView={activeView}
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
            {...(scopedFileTree !== undefined ? { scopedFileTree } : {})}
            treeView={
              <FileTree
                hideToolbar
                {...(scopedFileTree !== undefined ? { fileTreeOverride: scopedFileTree } : {})}
                onFileOpen={onFileOpen}
                onCreateFile={onCreateFile}
                onCreateFolder={onCreateFolder}
                onRename={onRename}
                onDelete={onDelete}
                onMove={onMove}
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
    </div>
  );
}
