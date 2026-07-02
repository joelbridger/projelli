/**
 * DocumentGridView — grid-style file browser for the Documents "Files" tab.
 *
 * Replaces the table-list layout with a card grid: folders first (sorted
 * alphabetically), then files, each showing an icon + name. Folder click
 * drills in; breadcrumb navigates back. All file actions (New document,
 * New folder, Add files, Search, Files/Trash toggle) are included.
 *
 * No Tailwind on layout — all inline styles + CSS vars to stay consistent
 * with the rest of the Documents surface.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Folder,
  FileText,
  File,
  Image,
  Film,
  Music,
  Plus,
  Search,
  ChevronRight,
} from 'lucide-react';
import { Button, EmptyState } from '@/ui/kp';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { TrashPanel } from '@/features/documents/TrashPanel';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { FileNode } from '@/platform/types/workspace';

// ── Icon helpers ───────────────────────────────────────────────────────────

function getGridIcon(node: FileNode): React.ReactNode {
  if (node.type === 'folder') {
    return (
      <Folder
        style={{ width: 32, height: 32, color: '#c0a960', strokeWidth: 1.5 }}
      />
    );
  }
  // Derive the extension from the file name (not node.extension) because the
  // TauriFSBackend does not populate the extension field on FileNode, so the
  // desktop icons were always falling through to the generic File glyph.
  const ext = (node.name.split('.').pop() ?? '').toLowerCase();
  if (ext === 'md' || ext === 'txt' || ext === 'source' || ext === 'rtf' || ext === 'rt') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: 'var(--kp-navy)', strokeWidth: 1.5, opacity: 0.6 }}
      />
    );
  }
  if (ext === 'docx' || ext === 'doc') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: '#2563eb', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'pdf') {
    return (
      <FileText
        style={{ width: 32, height: 32, color: '#dc2626', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg' || ext === 'bmp') {
    return (
      <Image
        style={{ width: 32, height: 32, color: '#16a34a', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'mp4' || ext === 'webm' || ext === 'mov' || ext === 'avi' || ext === 'mkv') {
    return (
      <Film
        style={{ width: 32, height: 32, color: '#7c3aed', strokeWidth: 1.5 }}
      />
    );
  }
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg' || ext === 'm4a') {
    return (
      <Music
        style={{ width: 32, height: 32, color: '#db2777', strokeWidth: 1.5 }}
      />
    );
  }
  return (
    <File
      style={{ width: 32, height: 32, color: 'var(--kp-navy)', strokeWidth: 1.5, opacity: 0.5 }}
    />
  );
}

// Recursively walk the (already client-scoped) tree so search can find a
// match anywhere in it, tracking each node's ancestor folder NAMES (same
// convention as QuickOpen's `flattenFiles`) for the result's path context.
// Pure (no component-state closures), so it lives at module scope and can be
// safely called from inside a `useMemo`.
function flattenForSearch(nodes: FileNode[], prefix = ''): { node: FileNode; folder: string }[] {
  const out: { node: FileNode; folder: string }[] = [];
  for (const node of nodes) {
    out.push({ node, folder: prefix });
    if (node.type === 'folder' && node.children) {
      const nextPrefix = prefix ? `${prefix}/${node.name}` : node.name;
      out.push(...flattenForSearch(node.children, nextPrefix));
    }
  }
  return out;
}

// Folders first, then files, each group alphabetically.
function compareNodes(a: FileNode, b: FileNode): number {
  if (a.type === b.type) return a.name.localeCompare(b.name);
  return a.type === 'folder' ? -1 : 1;
}

// ── Breadcrumb ─────────────────────────────────────────────────────────────

interface BreadcrumbSegment {
  label: string;
  path: string | null;
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate: (path: string | null) => void;
  /**
   * R6-1: drag a file/folder onto a breadcrumb to move it up a level (or to
   * the workspace root via the "All files" crumb). `targetPath` is null for
   * the root crumb; the parent resolves it to rootPath before moving.
   */
  onDropOnCrumb?: (sourcePath: string, targetPath: string | null) => Promise<void>;
}

function Breadcrumb({ segments, onNavigate, onDropOnCrumb }: BreadcrumbProps) {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  if (segments.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
      }}
    >
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        const isCrumbDragOver = dragOverIdx === idx;
        return (
          <React.Fragment key={seg.path ?? '__root__'}>
            {idx > 0 && (
              <ChevronRight
                style={{
                  width: 'var(--kp-icon-sm)',
                  height: 'var(--kp-icon-sm)',
                  color: 'var(--color-muted-foreground)',
                  strokeWidth: 2,
                  flex: 'none',
                }}
              />
            )}
            <button
              type="button"
              data-testid={`breadcrumb-crumb-${String(idx)}`}
              onClick={() => { onNavigate(seg.path); }}
              onDragOver={(e) => {
                if (!onDropOnCrumb) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDragOverIdx(idx);
              }}
              onDragLeave={() => { setDragOverIdx(null); }}
              onDrop={(e) => {
                if (!onDropOnCrumb) return;
                e.preventDefault();
                setDragOverIdx(null);
                const sourcePath = e.dataTransfer.getData('text/plain');
                if (sourcePath) {
                  void onDropOnCrumb(sourcePath, seg.path);
                }
              }}
              style={{
                fontSize: 'var(--kp-font-sm)',
                fontWeight: isLast ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
                color: isLast ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                background: isCrumbDragOver ? 'rgba(10,37,64,0.08)' : 'none',
                border: isCrumbDragOver
                  ? '1px dashed var(--kp-navy)'
                  : '1px solid transparent',
                borderRadius: 4,
                cursor: isLast ? 'default' : 'pointer',
                padding: '1px 4px',
                fontFamily: 'Satoshi, sans-serif',
                lineHeight: 'var(--kp-leading-snug)',
              }}
            >
              {seg.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── File card ──────────────────────────────────────────────────────────────

interface FileCardProps {
  node: FileNode;
  isActive: boolean;
  onOpen: (node: FileNode) => void;
  /**
   * R6-1: drag-and-drop. When present, the card is draggable (writes its path
   * to text/plain on dragStart) and FOLDER cards accept drops, calling
   * `onMoveInto(sourcePath, folder.path)`. The self/descendant guard lives in
   * the parent so we never move a folder into itself or a child of itself.
   */
  onMoveInto?: (sourcePath: string, targetFolderPath: string) => Promise<void>;
  /**
   * Ancestor folder path (name-joined, e.g. "Contracts/2026"), shown only
   * while a whole-tree search is active and the match lives outside the
   * folder the user currently has open — gives cross-folder results context
   * so opening one doesn't feel like a teleport.
   */
  pathContext?: string;
}

function FileCard({ node, isActive, onOpen, onMoveInto, pathContext }: FileCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isFolder = node.type === 'folder';

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.path);
      setIsDragging(true);
    },
    [node.path],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Only folders are valid drop targets, and only when moving is wired.
      if (!isFolder || !onMoveInto) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    },
    [isFolder, onMoveInto],
  );

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isFolder || !onMoveInto) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath) return;
      // Guard: never drop a node onto itself or a folder into its own subtree.
      if (sourcePath === node.path) return;
      if (node.path === sourcePath || node.path.startsWith(`${sourcePath}/`)) return;
      await onMoveInto(sourcePath, node.path);
    },
    [isFolder, onMoveInto, node.path],
  );

  // Dynamic states (drag-over, active, dragging) are layered via style on top of
  // the kp-card--interactive CSS classes. Card's :hover shadow is intentionally
  // left to the CSS; we only override border-color and background for the
  // drag/active states that need runtime values.
  const dynamicStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 'var(--kp-space-xs)',
    padding: 'var(--kp-space-md) var(--kp-space-sm)',
    textAlign: 'center',
    width: '100%',
    minWidth: 0,
    fontFamily: 'Satoshi, sans-serif',
    opacity: isDragging ? 0.5 : 1,
    ...(isDragOver && isFolder
      ? { borderStyle: 'dashed', borderColor: 'var(--kp-navy)', background: 'rgba(10,37,64,0.08)' }
      : isActive
        ? { borderColor: 'var(--kp-navy)', borderWidth: 2, background: 'rgba(10,37,64,0.04)' }
        : {}),
  };

  return (
    <button
      type="button"
      className="kp-card kp-card--interactive"
      data-testid={`grid-card-${node.path}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => { void handleDrop(e); }}
      onClick={() => { onOpen(node); }}
      style={dynamicStyle}
    >
      {getGridIcon(node)}
      <span
        style={{
          fontSize: 'var(--kp-font-xs)',
          fontWeight: node.type === 'folder' ? 'var(--kp-weight-bold)' : 'var(--kp-weight-medium)',
          color: 'var(--kp-navy)',
          wordBreak: 'break-word',
          lineHeight: 'var(--kp-leading-tight)',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {node.name}
      </span>
      {pathContext && (
        <span
          data-testid={`grid-card-context-${node.path}`}
          style={{
            fontSize: 10,
            color: 'var(--color-muted-foreground)',
            wordBreak: 'break-word',
            lineHeight: 'var(--kp-leading-tight)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {pathContext}
        </span>
      )}
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

interface WorkspaceEmptyStateProps {
  onCreateDocument: () => void;
  onCreateFolder: () => void;
}

function WorkspaceEmptyState({ onCreateDocument, onCreateFolder }: WorkspaceEmptyStateProps) {
  return (
    <div data-testid="grid-empty-state">
      <EmptyState
        icon={Folder}
        title="Your workspace is ready"
        body="Real Word documents, with tracked changes and AI redlining, stored as files on your computer."
        actions={
          <>
            {/* eslint-disable lantern-i18n/no-hardcoded-string */}
            <Button variant="primary" size="md" iconLeft={Plus} onClick={onCreateDocument}>
              New Word document
            </Button>
            <Button variant="secondary" size="md" onClick={onCreateFolder}>
              New folder
            </Button>
            {/* eslint-enable lantern-i18n/no-hardcoded-string */}
          </>
        }
      />
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface DocumentGridViewProps {
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onMove: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload: (path: string, name: string) => void;
  /**
   * Controlled: which sub-view is active — 'files' or 'trash'. Lifted to
   * DocumentsHome so the toolbar can live above the tab strip.
   */
  activeView: 'files' | 'trash';
  /**
   * Controlled: current search query. Lifted to DocumentsHome so
   * the SearchField in the toolbar can live above the tab strip.
   */
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  /** Current Files view mode: 'tree' or 'grid'. */
  docsView: 'tree' | 'grid';
  /** The drilled-into folder (null = root), controlled by the parent so the
   *  toolbar's create buttons land new items in the folder you're viewing. */
  currentFolderPath: string | null;
  onSetCurrentFolderPath: (p: string | null) => void;
  /** The FileTree element to render when docsView === 'tree'. Passed in from the parent to avoid threading ~12 FileTree callbacks through here. */
  treeView: React.ReactNode;
  /**
   * R6-1: both create-document shortcuts now take an optional parentPath so a
   * new document lands in the folder the user currently has open (mirrors how
   * "New folder" already passes `currentFolderPath ?? rootPath`). When absent,
   * App.tsx falls back to the workspace `docs/` folder.
   */
  onCreateDefaultDocument?: (parentPath?: string) => void;
  onCreateDocxAtRoot?: (parentPath?: string) => void;
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  retentionPeriod?: TrashRetentionPeriod;
  customRetentionDays?: number;
  onRetentionChange?: (period: TrashRetentionPeriod, customDays?: number) => void;
  /**
   * When set, the grid renders THIS pre-scoped tree instead of the full
   * workspace tree from the store. Used by the per-client Documents sub-tab to
   * show only the client's folders (see `scopeFileTreeToFolders`). Undefined =
   * the normal global file browser.
   */
  scopedFileTree?: FileNode[];
  /**
   * Embedded (per-client) only: the folder a new document/folder lands in when
   * the user is at the scoped root (currentFolderPath === null) — the client's
   * own folder, so creates never fall back to the GLOBAL workspace. Navigation
   * is unaffected; this only changes the create target (matter isolation).
   */
  createFolderFallback?: string | null;
}

// ── Main export ────────────────────────────────────────────────────────────

export function DocumentGridView({
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onMove,
  onCreateDefaultDocument,
  onCreateDocxAtRoot,
  trashItems,
  trashStats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod,
  customRetentionDays,
  onRetentionChange,
  activeView,
  searchQuery,
  onSearchQueryChange,
  docsView,
  currentFolderPath,
  onSetCurrentFolderPath,
  treeView,
  scopedFileTree,
  createFolderFallback,
}: DocumentGridViewProps) {
  const storeFileTree = useWorkspaceStore((s) => s.fileTree);
  // Per-client Documents sub-tab passes a pre-scoped tree; the global browser
  // uses the full workspace tree from the store.
  const fileTree = scopedFileTree ?? storeFileTree;
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const activeTabPath = useEditorStore((s) => s.activeTabPath);
  const openTabs = useEditorStore((s) => s.openTabs);

  // currentFolderPath is controlled by the parent (lifted so the parent toolbar's
  // create buttons can target the folder you're viewing). Breadcrumbs derive from it.

  // ── Tree helpers ─────────────────────────────────────────────────────────

  function findNodeByPath(nodes: FileNode[], targetPath: string): FileNode | null {
    for (const node of nodes) {
      if (node.path === targetPath) return node;
      if (node.type === 'folder' && node.children) {
        const found = findNodeByPath(node.children, targetPath);
        if (found !== null) return found;
      }
    }
    return null;
  }

  const folderNode = currentFolderPath !== null ? findNodeByPath(fileTree, currentFolderPath) : null;
  // A folder path that doesn't resolve in this tree (e.g. it was deleted or
  // renamed, or is a stale/differently-shaped path) should never render an
  // empty grid when the scoped/global tree actually has files — fall back to
  // the root instead.
  const folderNotFound = currentFolderPath !== null && folderNode === null;

  let currentNodes: FileNode[] = [];
  if (currentFolderPath === null) {
    currentNodes = fileTree;
  } else {
    currentNodes = folderNode ? (folderNode.children ?? []) : fileTree;
  }

  // Codex review (P2, round 4): the fallback above renders root-level content,
  // but WITHOUT this, the parent's `currentFolderPath` (used as the toolbar's
  // create/import target — see DocumentsHome's `createTargetPath`) stays
  // stale. Since a write recreates missing parent folders, clicking "New
  // document" while the grid shows this fallback could silently RECREATE a
  // folder the user just deleted/renamed. Sync the parent back to null (the
  // root actually being shown) the moment the lookup misses.
  useEffect(() => {
    if (folderNotFound) {
      onSetCurrentFolderPath(null);
    }
  }, [folderNotFound, onSetCurrentFolderPath]);

  const isSearching = searchQuery.trim().length > 0;

  // `scopeFileTreeToFolders` keeps ancestor wrapper folders purely so the
  // client's mapped folder stays reachable (e.g. "Clients"). If that folder
  // happens to be nested under a DIFFERENT client's own folder, the wrapper
  // chain can include that other client's folder name — search itself never
  // crosses the matter boundary (fileTree is already pruned), but the path
  // CONTEXT shown on a result card could otherwise leak that name (Codex
  // review). `createFolderFallback` is this client's own root (absolute);
  // trim the shown context down to start at its own folder, never above it.
  const scopeRootName = createFolderFallback
    ? createFolderFallback.split('/').filter(Boolean).pop()
    : undefined;

  function trimToScopeRoot(folder: string): string {
    if (!scopeRootName || !folder) return folder;
    const parts = folder.split('/');
    const idx = parts.indexOf(scopeRootName);
    return idx === -1 ? folder : parts.slice(idx + 1).join('/');
  }

  // Fix (B4b): search must span the client's ENTIRE scoped tree (`fileTree` —
  // already pruned to this client's own folders by `scopeFileTreeToFolders`
  // for the embedded per-client tab, or the full workspace tree for the
  // global browser), not just `currentNodes` (the open folder's direct
  // children). Previously both browsing AND search filtered `currentNodes`,
  // so a match living in a sibling/ancestor/nested folder never surfaced.
  // `folder` (name-joined ancestor path) rides along so cross-folder matches
  // can show WHERE they live; it is unused while browsing (not searching).
  //
  // Flattening + sorting is O(tree size); memoized against `fileTree` (not
  // `searchQuery`) so it runs once per tree change, not once per keystroke —
  // otherwise every character typed re-walks and re-sorts the whole client
  // folder (Codex review).
  const flattenedSorted = useMemo(() => {
    const flat = flattenForSearch(fileTree).map((e) => ({
      node: e.node,
      folder: trimToScopeRoot(e.folder),
    }));
    return flat.sort((a, b) => compareNodes(a.node, b.node));
    // trimToScopeRoot is a pure function of `scopeRootName`, already a dep below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree, scopeRootName]);

  const searchEntries: { node: FileNode; folder: string }[] = isSearching
    ? flattenedSorted
    : currentNodes.map((node) => ({ node, folder: '' }));

  const sortedEntries = isSearching
    ? searchEntries
    : [...searchEntries].sort((a, b) => compareNodes(a.node, b.node));

  const filteredEntries = isSearching
    ? sortedEntries.filter((e) =>
        e.node.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : sortedEntries;

  const filteredNodes = filteredEntries.map((e) => e.node);

  // ── Breadcrumbs ─────────────────────────────────────────────────────────

  function buildBreadcrumbs(): BreadcrumbSegment[] {
    if (currentFolderPath === null) return [];

    const segments: BreadcrumbSegment[] = [{ label: 'All files', path: null }];

    function collectAncestors(
      nodes: FileNode[],
      targetPath: string,
      accumulated: BreadcrumbSegment[],
    ): boolean {
      for (const node of nodes) {
        if (node.type !== 'folder') continue;
        const next = [...accumulated, { label: node.name, path: node.path }];
        if (node.path === targetPath) {
          segments.push(...next);
          return true;
        }
        if (node.children && collectAncestors(node.children, targetPath, next)) {
          return true;
        }
      }
      return false;
    }

    collectAncestors(fileTree, currentFolderPath, []);
    return segments;
  }

  const breadcrumbs = buildBreadcrumbs();

  // ── File counts ─────────────────────────────────────────────────────────

  // Count items at the CURRENT directory level when browsing. A search
  // spans the whole scoped tree (not just this folder), so its count is
  // reported separately as a result count rather than "N of M" — "M" would
  // otherwise misleadingly imply the tree's total size is this folder's size.
  const currentDirCount = currentNodes.length;
  const filteredCount = filteredNodes.length;

  function currentDirLabel(): string {
    if (isSearching) {
      return filteredCount === 1 ? '1 result' : `${String(filteredCount)} results`;
    }

    if (currentDirCount === 0) return 'No items';

    const folderCount = currentNodes.filter((n) => n.type === 'folder').length;
    const fileCount = currentNodes.filter((n) => n.type !== 'folder').length;
    if (folderCount > 0 && fileCount === 0) {
      return folderCount === 1 ? '1 folder' : `${String(folderCount)} folders`;
    }
    if (fileCount > 0 && folderCount === 0) {
      return fileCount === 1 ? '1 item' : `${String(fileCount)} items`;
    }
    return currentDirCount === 1 ? '1 item' : `${String(currentDirCount)} items`;
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleNodeOpen = useCallback((node: FileNode) => {
    if (node.type === 'folder') {
      onSetCurrentFolderPath(node.path);
      onSearchQueryChange('');
    } else {
      void onFileOpen(node.path, node.name);
    }
  }, [onFileOpen, onSearchQueryChange]);

  function handleCreateDocument() {
    // R6-1: thread the open folder so a new document lands where the user is.
    // When at root (currentFolderPath === null) we pass undefined and App.tsx
    // falls back to its canonical `docs/` folder — same contract as before.
    // Embedded (per-client): `createFolderFallback` keeps a root-level create
    // inside the client's folder instead of the global workspace (isolation).
    const parentPath = currentFolderPath ?? createFolderFallback ?? undefined;
    if (onCreateDefaultDocument) {
      onCreateDefaultDocument(parentPath);
    } else if (onCreateDocxAtRoot) {
      onCreateDocxAtRoot(parentPath);
    } else {
      onCreateFile(currentFolderPath ?? createFolderFallback ?? rootPath ?? '');
    }
  }

  function handleCreateFolder() {
    onCreateFolder(currentFolderPath ?? createFolderFallback ?? rootPath ?? '');
  }

  // R6-1: grid drag-and-drop. Dropping a card onto a FOLDER card moves it
  // into that folder; the self/descendant guard lives in FileCard. App.tsx's
  // onMove refreshes the workspace store, so the tree + grid update after.
  // TODO(a11y): drag-and-drop is the only way to move files in this grid.
  // A keyboard "Move to folder" affordance is still needed — e.g. a context-menu
  // action or a modal folder picker triggered by a keyboard shortcut. Design
  // decision deferred; leaving this note so it stays on record.
  const handleMoveInto = useCallback(
    async (sourcePath: string, targetFolderPath: string) => {
      await onMove(sourcePath, targetFolderPath);
    },
    [onMove],
  );

  // R6-1: dropping a card onto a breadcrumb moves it up a level (or to the
  // workspace root via the "All files" crumb, whose path is null).
  const handleDropOnCrumb = useCallback(
    async (sourcePath: string, crumbPath: string | null) => {
      const target = crumbPath ?? rootPath;
      if (!target) return;
      // No-op if it's already a direct child of the target folder.
      const sourceDir = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
      if (sourceDir === target) return;
      // Never move a folder into its own subtree (or onto itself).
      if (target === sourcePath || target.startsWith(`${sourcePath}/`)) return;
      await onMove(sourcePath, target);
    },
    [onMove, rootPath],
  );

  // ── Is a node the active tab? ────────────────────────────────────────────

  function isNodeActive(node: FileNode): boolean {
    if (node.type === 'folder') return false;
    return (
      node.path === activeTabPath &&
      openTabs.some((t) => {
        const tabType = t.type ?? 'file';
        return (
          t.path === activeTabPath &&
          tabType !== 'ai-assistant' &&
          tabType !== 'workflow-execution' &&
          tabType !== 'email'
        );
      })
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="document-grid-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* ── Content area ───────────────────────────────────────────────── */}
      {activeView === 'files' && docsView === 'tree' ? (
        /* Tree view — full height, no padding wrapper */
        <div
          data-testid="documents-tree-view"
          style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {treeView}
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--kp-surface-gap) var(--kp-gutter)' }}>
        {activeView === 'files' ? (
          <>
            {/* Breadcrumb row */}
            {breadcrumbs.length > 0 && (
              <div style={{ marginBottom: 'var(--kp-space-sm)' }}>
                <Breadcrumb
                  segments={breadcrumbs}
                  onNavigate={(path) => {
                    onSetCurrentFolderPath(path);
                    onSearchQueryChange('');
                  }}
                  onDropOnCrumb={handleDropOnCrumb}
                />
              </div>
            )}

            {/* Subtitle */}
            {breadcrumbs.length === 0 && (
              <div
                data-testid="grid-dir-label"
                style={{
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--color-muted-foreground)',
                  marginBottom: 'var(--kp-space-sm)',
                  lineHeight: 'var(--kp-leading-normal)',
                }}
              >
                {fileTree.length === 0 ? 'No documents yet' : currentDirLabel()}
              </div>
            )}

            {/* Grid or empty state */}
            {fileTree.length === 0 ? (
              <WorkspaceEmptyState
                onCreateDocument={handleCreateDocument}
                onCreateFolder={handleCreateFolder}
              />
            ) : filteredNodes.length === 0 && isSearching ? (
              /* eslint-disable lantern-i18n/no-hardcoded-string */
              <EmptyState
                icon={Search}
                title="No results"
                body="No files match your search. Try a different name."
                compact
              />
              /* eslint-enable lantern-i18n/no-hardcoded-string */
            ) : filteredNodes.length === 0 ? (
              <WorkspaceEmptyState
                onCreateDocument={handleCreateDocument}
                onCreateFolder={handleCreateFolder}
              />
            ) : (
              <div
                data-testid="document-grid-cards"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 'var(--kp-space-md)',
                }}
              >
                {filteredEntries.map(({ node, folder }) => (
                  <FileCard
                    key={node.id}
                    node={node}
                    isActive={isNodeActive(node)}
                    onOpen={handleNodeOpen}
                    onMoveInto={handleMoveInto}
                    {...(isSearching && folder ? { pathContext: folder } : {})}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          /* Trash view */
          <div
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            <TrashPanel
              items={trashItems}
              stats={trashStats}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onEmptyTrash={onEmptyTrash}
              {...(retentionPeriod !== undefined ? { retentionPeriod } : {})}
              {...(customRetentionDays !== undefined ? { customRetentionDays } : {})}
              {...(onRetentionChange !== undefined ? { onRetentionChange } : {})}
            />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
