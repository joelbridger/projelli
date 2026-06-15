/**
 * ReimaginedDocumentsHome — R4 redesign: "Files" as a pinned tab.
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, FolderTree, FileText, X, LayoutGrid, ListTree, Upload } from 'lucide-react';
import { SurfaceHeader } from '@/components/layout/SurfaceHeader';
import { useEditorStore } from '@/stores/editorStore';
import { getFileIcon } from '@/utils/fileIcons';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import type { TrashRetentionPeriod } from '@/components/common/TrashPanel';
import { DocumentGridView } from './DocumentGridView';
import { FileTree } from '@/components/workspace/FileTree';

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

export interface ReimaginedDocumentsHomeProps {
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
  onCreateDocxAtRoot?: (parentPath?: string) => void;
  /**
   * R6-1: the vertical expanding tree view (FileTree) shares the Files surface
   * with the grid via a Tree | Grid toggle. The tree's toolbar offers the same
   * "new at root" creators the sidebar tree does; these are threaded through so
   * the toolbar is fully functional. All are optional — when absent the
   * corresponding toolbar entry simply no-ops, exactly as FileTree allows.
   */
  onCreateMarkdownAtRoot?: () => void;
  onCreateTextFileAtRoot?: () => void;
  onCreateRichTextFileAtRoot?: () => void;
  onCreateFolderAtRoot?: () => void;
  onCreateWhiteboard?: (parentPath: string) => void;
  onSetLetterheadTemplate?: (path: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const REAL_FILE_TYPES = new Set(['file', 'browser', 'whiteboard', 'email']);

function isRealFileTab(type: string): boolean {
  return REAL_FILE_TYPES.has(type);
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--kp-space-sm)',
        padding: 'var(--kp-space-xs) var(--kp-gutter)',
        background: '#eef4ff',
        borderBottom: '1px solid #c7d9f8',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', flex: 1, minWidth: 0 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'var(--kp-navy)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <FileText style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#fff', strokeWidth: 2 }} />
        </div>
        <span
          style={{
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            color: 'var(--kp-navy)',
            fontFamily: 'Satoshi, sans-serif',
            lineHeight: 'var(--kp-leading-normal)',
          }}
        >
          {/* eslint-disable keepance-i18n/no-hardcoded-string */}
          Indexed on your machine. Nothing was uploaded.
          {/* eslint-enable keepance-i18n/no-hardcoded-string */}
        </span>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          color: 'var(--kp-navy)',
          opacity: 0.6,
          flex: 'none',
        }}
      >
        <X style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
      </button>
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
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            alignSelf: 'center',
            borderRadius: 3,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: 'var(--color-muted-foreground)',
            padding: 0,
            flex: 'none',
            marginRight: 4,
            opacity: isHovered ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
        >
          <X style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
        </button>
      )}
    </div>
  );
}

// ── Tree | Grid view toggle ─────────────────────────────────────────────────

interface ViewToggleProps {
  view: DocsView;
  onChange: (view: DocsView) => void;
}

function ViewToggle({ view, onChange }: ViewToggleProps) {
  const segBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 10px',
    fontSize: 'var(--kp-font-xs)',
    fontWeight: 'var(--kp-weight-semibold)',
    cursor: 'pointer',
    border: 'none',
    borderRadius: 0,
    transition: 'background 0.1s, color 0.1s',
    fontFamily: 'Satoshi, sans-serif',
    whiteSpace: 'nowrap',
  };
  const active: React.CSSProperties = { background: 'var(--kp-navy)', color: '#fff' };
  const inactive: React.CSSProperties = { background: '#fff', color: 'var(--color-muted-foreground)' };

  return (
    <div
      data-testid="docs-view-toggle"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: 'var(--kp-space-xs) var(--kp-gutter)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
        background: 'var(--color-background)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
      >
        <button
          type="button"
          data-testid="docs-view-tree"
          aria-pressed={view === 'tree'}
          title="Tree view"
          style={{
            ...segBase,
            ...(view === 'tree' ? active : inactive),
            borderRight: '1px solid var(--color-border)',
          }}
          onClick={() => { onChange('tree'); }}
        >
          <ListTree style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
          Tree
        </button>
        <button
          type="button"
          data-testid="docs-view-grid"
          aria-pressed={view === 'grid'}
          title="Grid view"
          style={{
            ...segBase,
            ...(view === 'grid' ? active : inactive),
          }}
          onClick={() => { onChange('grid'); }}
        >
          <LayoutGrid style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
          Grid
        </button>
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export function ReimaginedDocumentsHome({
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
  onCreateDocxAtRoot,
  onCreateMarkdownAtRoot,
  onCreateTextFileAtRoot,
  onCreateRichTextFileAtRoot,
  onCreateFolderAtRoot,
  onCreateWhiteboard,
  onSetLetterheadTemplate,
}: ReimaginedDocumentsHomeProps) {
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);

  // Trust banner state
  const [showTrustBanner, setShowTrustBanner] = useState(false);

  // R6-1: Tree | Grid toggle for the Files surface. Restored from localStorage.
  const [docsView, setDocsView] = useState<DocsView>(() => readDocsView());
  const handleSetDocsView = useCallback((view: DocsView) => {
    setDocsView(view);
    writeDocsView(view);
  }, []);

  // "userOnFiles" tracks whether the user explicitly clicked the "Files" tab.
  // When false, the active document tab in editorStore drives what is shown.
  // When a new real-file tab becomes active externally (email-open flow, grid
  // card click), we flip back to false via a ref — no setState inside an effect.
  // Initialize from documentsView on mount. Because this component remounts on
  // every nav, the useState initializer is the reliable place to honor the
  // intent: 'browser' => show the Files list; 'editor'/undefined => editor
  // (legacy default when the prop is absent in tests/browser).
  const initialOnFiles = documentsView === 'browser';
  const [userOnFiles, setUserOnFiles] = useState(initialOnFiles);
  // Ref that shadows userOnFiles so we can read it synchronously in the effect
  // without capturing a stale closure.
  const userOnFilesRef = useRef(initialOnFiles);

  // Track the last real-file path the store told us about; when it changes
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
    if (!isRealFileTab(matchingTab.type ?? 'file')) return;
    if (prevActivePathRef.current === activeTabPath) return;
    prevActivePathRef.current = activeTabPath;
    // A real-file tab became active externally: navigate away from the Files
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
          (t) => t.path !== tabPath && isRealFileTab(t.type ?? 'file'),
        );
        if (remaining.length === 0) {
          userOnFilesRef.current = true;
          setUserOnFiles(true);
        }
      }
    },
    [closeTab, activeTabPath, openTabs],
  );

  // ── Add-files / trust-note logic ─────────────────────────────────────────

  const handleAddFiles = useCallback(() => {
    if (!hasTrustBeenShown()) {
      setShowTrustBanner(true);
      markTrustShown();
    }
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument();
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot();
    } else {
      onCreateFile('');
    }
  }, [onCreateDefaultDocument, onCreateDocxAtRoot, onCreateFile]);

  const handleDismissTrust = useCallback(() => {
    setShowTrustBanner(false);
  }, []);

  // ── Derived content state ────────────────────────────────────────────────

  // Only real-file tabs appear in the strip.
  const visibleTabs = openTabs.filter((t) => isRealFileTab(t.type ?? 'file'));

  // Show the grid when: user explicitly clicked Files, OR no real-file tabs exist.
  const showFilesGrid = userOnFiles || visibleTabs.length === 0;

  // The "selected" tab path for highlight purposes in the strip.
  const selectedTab = showFilesGrid ? FILES_TAB_ID : (activeTabPath ?? FILES_TAB_ID);

  // ── Tab icon helper ──────────────────────────────────────────────────────

  function getTabIcon(tab: { name: string; type?: string }) {
    if (tab.type === 'email') {
      return <FileText style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: '#0A2540', strokeWidth: 2 }} />;
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
      data-testid="reimagined-documents-split"
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
      {/* Page header */}
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={FolderTree}
          title="Documents"
          description="Your files and folders, on your computer."
        />
      </div>

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
          /* Files surface — a Tree | Grid toggle header, then the chosen view. */
          <>
            <ViewToggle view={docsView} onChange={handleSetDocsView} />
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {docsView === 'tree' ? (
                /* Vertical EXPANDING tree (reused as-is) with working drag-into-
                   folder DnD. It reads the workspace store directly. */
                <div data-testid="documents-tree-view" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Fix 4: Add files toolbar for tree mode, mirrors grid mode. */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--kp-space-xs)',
                      padding: 'var(--kp-space-xs) var(--kp-gutter)',
                      borderBottom: '1px solid var(--color-border)',
                      flexShrink: 0,
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      type="button"
                      data-testid="tree-add-files-btn"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 11px',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--kp-font-xs)',
                        fontWeight: 'var(--kp-weight-semibold)',
                        background: '#fff',
                        color: 'var(--kp-navy)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                        fontFamily: 'Satoshi, sans-serif',
                        whiteSpace: 'nowrap',
                      }}
                      onClick={handleAddFiles}
                    >
                      <Upload style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2 }} />
                      Add files
                    </button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <FileTree
                      onFileOpen={onFileOpen}
                      onCreateFile={onCreateFile}
                      onCreateFolder={onCreateFolder}
                      onRename={onRename}
                      onDelete={onDelete}
                      onMove={onMove}
                      onDownload={onDownload}
                      {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
                      {...(onCreateMarkdownAtRoot !== undefined ? { onCreateMarkdownAtRoot } : {})}
                      {...(onCreateTextFileAtRoot !== undefined ? { onCreateTextFileAtRoot } : {})}
                      {...(onCreateRichTextFileAtRoot !== undefined ? { onCreateRichTextFileAtRoot } : {})}
                      {...(onCreateFolderAtRoot !== undefined ? { onCreateFolderAtRoot } : {})}
                      {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
                      {...(onCreateWhiteboard !== undefined ? { onCreateWhiteboard } : {})}
                      {...(onSetLetterheadTemplate !== undefined ? { onSetLetterheadTemplate } : {})}
                    />
                  </div>
                </div>
              ) : (
                /* Folder-drill grid — shown when "Files" tab is active */
                <DocumentGridView
                  onFileOpen={onFileOpen}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  onRename={onRename}
                  onDelete={onDelete}
                  onMove={onMove}
                  onDownload={onDownload}
                  onAddFiles={handleAddFiles}
                  trashItems={trashItems}
                  trashStats={trashStats}
                  onRestore={onRestore}
                  onPermanentDelete={onPermanentDelete}
                  onEmptyTrash={onEmptyTrash}
                  {...(onCreateDefaultDocument !== undefined ? { onCreateDefaultDocument } : {})}
                  {...(onCreateDocxAtRoot !== undefined ? { onCreateDocxAtRoot } : {})}
                  {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
                  {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
                  {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
                />
              )}
            </div>
          </>
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
