// File Tree Component
// Displays workspace folder structure with expand/collapse and context menus

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileNode } from '@/platform/types/workspace';
import { visibleNodes } from '@/features/documents/workspace/hiddenNodes';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  File,
  Folder,
  FolderOpen,
  MoreVertical,
  FilePlus,
  FolderPlus,
  Upload,
  Download,
  BookOpen,
  Mic,
  ExternalLink,
  Trash2,
  X,
  Table,
  FileSpreadsheet,
  FileType,
  FileText,
} from 'lucide-react';
import { getFileIcon } from '@/platform/utils/fileIcons';
import { useConfirmDialog } from '@/platform/hooks/useConfirmDialog';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Button } from '@/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { EmptyState } from '@/ui/EmptyState';
import { AI_MESSAGE_MIME } from '@/platform/utils/fileDrop';
import { isAbsolutePath } from '@/platform/fs/pathResolve';
import { cn } from '@/lib/utils';
import { PrivilegeMenuItems } from '@/features/firm/privilege/PrivilegeMenuItems';
import { PrivilegeIndicator } from '@/features/firm/privilege/PrivilegeIndicator';
import { usePrivilegeForSource } from '@/platform/firm/privilegeStore';

/**
 * Resolve a workspace-relative `selectedPath` to an absolute path suitable for
 * the OS file explorer, using the separator convention encoded in `rootPath`.
 *
 * Rules:
 *   - If `selectedPath` is null, return `rootPath` unchanged.
 *   - If the resolved path is already absolute (POSIX "/", Windows "X:\" / "X:/",
 *     or UNC "\\\\server\\share"), return it unchanged.
 *   - Otherwise join `rootPath` + native separator + `selectedPath`.
 *   - On Windows (rootPath contains "\"), normalise any forward slashes in the
 *     relative portion to backslashes so the final path uses a uniform separator.
 *
 * SEPARATOR NOTE: unlike resolveWorkspacePath in pathResolve.ts (which uses
 * forward-slash joins for native command / std::fs paths), this function MUST
 * use OS-native separators because the result is passed to explorer.exe / open
 * / xdg-open, which require platform-native paths.
 *
 * Uses `isAbsolutePath` from pathResolve.ts as the single absolute-detection
 * source of truth so UNC paths (\\\\server\\share) pass through correctly.
 *
 * This is the single source of truth called by `handleOpenInExplorer`; the unit
 * tests import it directly so they guard the REAL logic, not a copy.
 */
export function resolveExplorerPath(rootPath: string, selectedPath: string | null): string {
  const pathToOpen = selectedPath || rootPath;
  // Already absolute: POSIX, Windows drive-rooted, or UNC (\\server\share).
  // Use isAbsolutePath from pathResolve.ts as the canonical check.
  if (isAbsolutePath(pathToOpen)) {
    return pathToOpen;
  }
  // Detect separator from rootPath
  const sep = rootPath.includes('\\') ? '\\' : '/';
  // Strip any trailing separator from rootPath to avoid doubles
  const root = rootPath.replace(/[/\\]+$/, '');
  // Strip any leading separator from relative path
  let rel = pathToOpen.replace(/^[/\\]+/, '');
  // On Windows, normalise forward slashes in the relative portion to backslashes
  if (sep === '\\') {
    rel = rel.replace(/\//g, '\\');
  }
  return `${root}${sep}${rel}`;
}

interface FileTreeProps {
  /** Hide the internal create-file/folder toolbar — used when a parent surface
   *  already provides those actions (e.g. the unified Documents toolbar). */
  hideToolbar?: boolean;
  onFileOpen: (path: string, name: string) => Promise<unknown>;
  onCreateFile?: (parentPath: string, extension?: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload?: (path: string, name: string) => void;
  onCreateFileAtRoot?: (extension?: string) => void;
  /**
   * WS-A / A5: create the user's DEFAULT new document type (Word .docx unless
   * changed in Settings). Used by the empty-state primary CTA.
   */
  onCreateDefaultDocument?: () => void;
  onCreateTextFileAtRoot?: () => void;
  onCreateSourceFileAtRoot?: () => void;
  onCreateFolderAtRoot?: () => void;
  onUploadFiles?: (files: FileList, targetFolder?: string) => Promise<void>;
  onOpenGridView?: () => void;
  onCreateAudioAtRoot?: () => void;
  onCreateSpreadsheetAtRoot?: () => void;
  onCreateCsvAtRoot?: () => void;
  onCreateDocxAtRoot?: () => void;
  onCreatePptxAtRoot?: () => void;
  /**
   * VG-4c: set this `.docx` as the firm letterhead template. Shown only on
   * `.docx` files in the per-file menu; the handler writes the
   * `letterheadTemplatePath` setting and confirms.
   */
  onSetLetterheadTemplate?: (path: string) => void;
  /**
   * UX-16: optional confirm dialog for bulk delete. When provided, the parent
   * supplies the modal. If omitted, FileTree falls back to its OWN in-app
   * ConfirmDialog (below) — NOT native window.confirm, which is dead in the
   * Tauri WebView2 build and returns a truthy object, so a bare confirm would
   * bulk-delete files to Trash without the user ever seeing a prompt. Real app
   * callers (DocumentsHome) don't pass this, so the internal fallback is the
   * production path.
   */
  onConfirm?: (
    message: string,
    options?: { title?: string; confirmLabel?: string; variant?: 'default' | 'destructive' }
  ) => Promise<boolean>;
  /**
   * UX-28: called when an AI chat message is dragged from the chat viewer
   * and dropped on the tree. `targetPath` is the folder the drop landed on,
   * or the workspace root when dropped on empty space. `existingFilePath`
   * is set when the drop landed on an existing file — in which case the
   * handler appends content rather than creating a new file.
   */
  onDropAIMessage?: (opts: {
    content: string;
    targetFolder: string;
    existingFilePath?: string;
  }) => Promise<void>;
  /**
   * When set, the tree renders THIS pre-scoped node list instead of the full
   * workspace tree from the store. Used by the per-client Documents sub-tab so
   * the tree shows only the client's folders. Undefined = the global tree.
   * Selection / expand / drag state still come from the store, so the scoped
   * tree behaves like a filtered view of the same workspace.
   */
  fileTreeOverride?: FileNode[];
}

export function FileTree({
  hideToolbar = false,
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  onCreateDefaultDocument,
  onCreateTextFileAtRoot,
  onCreateSourceFileAtRoot,
  onCreateFolderAtRoot,
  onUploadFiles,
  onCreateAudioAtRoot,
  onCreateSpreadsheetAtRoot,
  onCreateCsvAtRoot,
  onCreateDocxAtRoot,
  onCreatePptxAtRoot,
  onSetLetterheadTemplate,
  onConfirm,
  onDropAIMessage,
  fileTreeOverride,
}: FileTreeProps) {
  const {
    fileTree: storeFileTree,
    selectedPath,
    expandedPaths,
    selectPath,
    toggleExpanded,
    rootPath,
    selectedPaths,
    lastSelectedPath,
    togglePathSelection,
    addToSelection,
    selectRange,
    clearSelection,
  } = useWorkspaceStore();
  // Per-client Documents sub-tab passes a pre-scoped tree; the global tree uses
  // the full workspace tree from the store.
  const fileTree = fileTreeOverride ?? storeFileTree;
  const { t } = useTranslation();
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  // In-app confirm dialog used as the bulk-delete fallback when the parent does
  // not supply `onConfirm`. Replaces the dead native window.confirm so the
  // destructive flow always shows a real prompt in the WebView2 build.
  const { confirm: fallbackConfirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  // Handle dropping on the root area (empty space)
  const handleRootDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverPath('__root__');
  }, []);

  const handleRootDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  const handleRootDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOverPath(null);

      if (!rootPath) return;

      // UX-28: AI chat message drops carry our custom MIME. Route those
      // through onDropAIMessage BEFORE looking for multi-drag payloads —
      // the text/plain fallback is the raw message text, not a path.
      const aiMessage = e.dataTransfer.getData(AI_MESSAGE_MIME);
      if (aiMessage) {
        if (onDropAIMessage) {
          await onDropAIMessage({ content: aiMessage, targetFolder: rootPath });
        }
        return;
      }

      if (!onMove) return;

      const isMultiDrag = e.dataTransfer.getData('multi-drag') === 'true';
      const dataStr = e.dataTransfer.getData('text/plain');

      if (!dataStr) return;

      if (isMultiDrag) {
        // Handle multi-item drop to root
        try {
          const sourcePaths: string[] = JSON.parse(dataStr);

          // Move all items to root
          for (const sourcePath of sourcePaths) {
            await onMove(sourcePath, rootPath);
          }

          // Clear selection after successful multi-move
          clearSelection();
        } catch (error) {
          console.error('Failed to parse multi-drag data:', error);
        }
      } else {
        // Handle single-item drop to root
        const sourcePath = dataStr;
        await onMove(sourcePath, rootPath);
      }
    },
    [onMove, rootPath, clearSelection, onDropAIMessage]
  );

  const handleOpenInExplorer = useCallback(async () => {
    if (!rootPath) return;

    try {
      // Check if we're in Tauri environment (durable detection: match the
      // `__TAURI_INTERNALS__` transport OR the legacy `__TAURI__` global so this
      // survives a future `withGlobalTauri:false` flip).
      if (
        typeof window !== 'undefined' &&
        ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
      ) {
        // Use custom Tauri command to open in system file explorer.
        // Delegate to the exported resolveExplorerPath helper so the unit
        // tests exercise the exact code the handler runs.
        const { invoke } = await import('@tauri-apps/api/core');
        const pathToOpen = resolveExplorerPath(rootPath, selectedPath);
        await invoke('open_in_explorer', { path: pathToOpen });
      } else {
        // Fallback for browser - just show an alert
        alert('This feature is only available in the desktop app.');
      }
    } catch (error) {
      console.error('Failed to open in explorer:', error);
      alert(`Failed to open folder: ${String(error)}`);
    }
  }, [rootPath, selectedPath]);

  // Multi-select batch operations
  const handleBatchDelete = useCallback(async () => {
    if (!onDelete || selectedPaths.size === 0) return;

    // UX-16: replace window.confirm with the app's ConfirmDialog when
    // provided. Keeps the destructive bulk-delete flow on-brand and
    // accessible (Radix Dialog, proper a11y, keyboard-trap).
    const count = selectedPaths.size;
    const message = `Move ${count} file${count === 1 ? '' : 's'} to Trash?`;
    const confirmed = await (onConfirm ?? fallbackConfirm)(message, {
      title: 'Delete selected files',
      confirmLabel: `Move ${count} to Trash`,
      variant: 'destructive',
    });

    if (!confirmed) return;

    // Delete all selected items
    const pathsToDelete = Array.from(selectedPaths);
    for (const path of pathsToDelete) {
      await onDelete(path);
    }

    clearSelection();
  }, [selectedPaths, onDelete, clearSelection, onConfirm, fallbackConfirm]);

  const handleBatchDownload = useCallback(async () => {
    if (!onDownload || selectedPaths.size === 0) return;

    // Get file nodes for selected paths
    const findNodeByPath = (nodes: FileNode[], path: string): FileNode | null => {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = findNodeByPath(node.children, path);
          if (found) return found;
        }
      }
      return null;
    };

    // Download only files (not folders)
    for (const path of selectedPaths) {
      const node = findNodeByPath(fileTree, path);
      if (node && node.type === 'file') {
        await onDownload(path, node.name);
      }
    }
  }, [selectedPaths, onDownload, fileTree]);

  /**
   * Resolve the folder parent for toolbar create-folder actions.
   *
   * When something is selected:
   *   - selected node is a folder → use that folder's path
   *   - selected node is a file   → use its parent directory path
   * When nothing is selected, fall back to null (caller uses root).
   *
   * We look up the selection in `fileTree` only to distinguish folder vs file;
   * the path itself encodes the parent via the last "/" separator for files.
   */
  const resolvedFolderParent = (() => {
    if (!selectedPath) return null;
    // Walk the flat+nested tree to find the selected node's type
    const findNode = (nodes: typeof fileTree, target: string): (typeof fileTree)[number] | null => {
      for (const n of nodes) {
        if (n.path === target) return n;
        if (n.children) {
          const found = findNode(n.children, target);
          if (found) return found;
        }
      }
      return null;
    };
    const node = findNode(fileTree, selectedPath);
    if (!node) return null;
    if (node.type === 'folder') return node.path;
    // File: use the portion of the path before the last "/"
    const lastSlash = node.path.lastIndexOf('/');
    return lastSlash > 0 ? node.path.substring(0, lastSlash) : null;
  })();

  /** Handler for the toolbar "Folder" button that respects the current selection. */
  const handleToolbarCreateFolder = useCallback(() => {
    if (resolvedFolderParent && onCreateFolder) {
      onCreateFolder(resolvedFolderParent);
    } else {
      onCreateFolderAtRoot?.();
    }
  }, [resolvedFolderParent, onCreateFolder, onCreateFolderAtRoot]);

  return (
    <div data-testid="file-tree" className="flex flex-col h-full">
      {/* Toolbar with create buttons (hidden when a parent surface provides them) */}
      {!hideToolbar && (
      <div data-testid="file-tree-toolbar" className="flex items-center gap-1 px-2 py-1.5 border-b flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              data-testid="new-file-menu-trigger"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              title="Create new file"
            >
              <FilePlus className="h-3.5 w-3.5 mr-1" />
              File
              <ChevronDown className="h-3 w-3 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {/* WS-A / A5: Word (.docx) is the canonical document format, so it
                leads the menu. Markdown / text / rich text follow for notes. */}
            {onCreateDocxAtRoot && (
              <DropdownMenuItem
                data-testid="new-file-type-docx"
                onClick={onCreateDocxAtRoot}
              >
                <FileType className="h-3.5 w-3.5 mr-2 text-blue-600" />
                {t('workspace.file-tree.new.word-document')}
              </DropdownMenuItem>
            )}
            {onCreateDocxAtRoot && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={onCreateTextFileAtRoot}>
              <File className="h-3.5 w-3.5 mr-2" />
              {t('workspace.file-tree.new.plain-text')}
            </DropdownMenuItem>
            {onCreatePptxAtRoot && (
              <DropdownMenuItem
                data-testid="new-file-type-pptx"
                onClick={onCreatePptxAtRoot}
              >
                <FileType className="h-3.5 w-3.5 mr-2 text-orange-600" />
                PowerPoint (.pptx)
              </DropdownMenuItem>
            )}
            {onCreateSpreadsheetAtRoot && (
              <DropdownMenuItem
                data-testid="new-file-type-xlsx"
                onClick={onCreateSpreadsheetAtRoot}
              >
                <FileSpreadsheet className="h-3.5 w-3.5 mr-2 text-emerald-600" />
                Spreadsheet (.xlsx)
              </DropdownMenuItem>
            )}
            {onCreateCsvAtRoot && (
              <DropdownMenuItem
                data-testid="new-file-type-csv"
                onClick={onCreateCsvAtRoot}
              >
                <Table className="h-3.5 w-3.5 mr-2 text-emerald-500" />
                CSV (.csv)
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCreateSourceFileAtRoot}>
              <BookOpen className="h-3.5 w-3.5 mr-2" />
              Source (.source)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateAudioAtRoot}>
              <Mic className="h-3.5 w-3.5 mr-2" />
              {t('workspace.file-tree.new.audio-file')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          data-testid="new-folder-button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleToolbarCreateFolder}
          title={resolvedFolderParent ? `New folder in ${resolvedFolderParent.split('/').pop() ?? resolvedFolderParent}` : 'New folder at root'}
        >
          <FolderPlus className="h-3.5 w-3.5 mr-1" />
          Folder
        </Button>
        {onUploadFiles && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.multiple = true;
              input.accept = 'image/*,video/*,.md,.txt,.json,.pdf';
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files;
                if (files && files.length > 0) {
                  // Upload to selected folder if it's a folder, otherwise to root
                  const targetFolder = selectedPath && fileTree.find(n => n.path === selectedPath && n.type === 'folder')
                    ? selectedPath
                    : rootPath;
                  void onUploadFiles(files, targetFolder || undefined);
                }
              };
              input.click();
            }}
            title="Upload files to selected folder or root"
            data-testid="upload-button"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            Upload
          </Button>
        )}
        {/* Grid View button moved to Sidebar Files header (fix 3). */}
      </div>
      )}

      {/* Multi-select actions bar */}
      {selectedPaths.size > 0 && (
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t('workspace.file-tree.selected-count', { count: selectedPaths.size })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={clearSelection}
              title={t('workspace.file-tree.clear-selection')}
              aria-label={t('workspace.file-tree.clear-selection')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {onDownload && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleBatchDownload}
                title={t('workspace.file-tree.download-selected')}
                aria-label={t('workspace.file-tree.download-selected')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button
                data-testid="batch-delete"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                onClick={handleBatchDelete}
                title={t('workspace.file-tree.delete-selected')}
                aria-label={t('workspace.file-tree.delete-selected')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* File tree content */}
      {fileTree.length === 0 ? (
        <EmptyState
          panelName="files"
          icon={FilePlus}
          title={t('workspace.file-tree.empty-title')}
          description={t('workspace.file-tree.empty-description')}
          {...(onCreateDefaultDocument
            ? { cta: { label: t('workspace.documents.new-document'), onClick: onCreateDefaultDocument } }
            : {})}
        />
      ) : (
        <div
          role="tree"
          aria-label="Workspace files"
          className="py-2 min-h-[200px] flex-1 overflow-auto"
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={handleRootDrop}
        >
          {/* Root drop indicator */}
          {dragOverPath === '__root__' && (
            <div className="mx-2 mb-1 px-2 py-1 border-2 border-dashed border-primary rounded bg-primary/10 text-xs text-primary">
              {t('workspace.file-tree.drop-to-root')}
            </div>
          )}
          {visibleNodes(fileTree).map((node) => (
            <FileTreeItem
              key={node.id}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              selectedPaths={selectedPaths}
              lastSelectedPath={lastSelectedPath}
              onSelect={selectPath}
              onToggle={toggleExpanded}
              onFileOpen={onFileOpen}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              onDownload={onDownload}
              onSetLetterheadTemplate={onSetLetterheadTemplate}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              togglePathSelection={togglePathSelection}
              addToSelection={addToSelection}
              selectRange={selectRange}
              clearSelection={clearSelection}
              onDropAIMessage={onDropAIMessage}
              rootPath={rootPath}
            />
          ))}
        </div>
      )}

      {/* Footer with "Open on Desktop" link */}
      {rootPath && !hideToolbar && (
        <div className="border-t px-2 py-2">
          <Button
            data-testid="open-on-desktop"
            variant="ghost"
            size="sm"
            className="w-full justify-start h-8 text-xs"
            onClick={handleOpenInExplorer}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-2" />
            {t('workspace.file-tree.open-on-desktop')}
          </Button>
        </div>
      )}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}

interface FileTreeItemProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  lastSelectedPath: string | null;
  onSelect: (path: string | null) => void;
  onToggle: (path: string) => void;
  onFileOpen: (path: string, name: string) => Promise<unknown>;
  onCreateFile: ((parentPath: string) => void) | undefined;
  onCreateFolder: ((parentPath: string) => void) | undefined;
  onRename: ((path: string) => void) | undefined;
  onDelete: ((path: string) => void) | undefined;
  onMove: ((sourcePath: string, targetPath: string) => Promise<void>) | undefined;
  onDownload: ((path: string, name: string) => void) | undefined;
  onSetLetterheadTemplate: ((path: string) => void) | undefined;
  dragOverPath: string | null;
  setDragOverPath: (path: string | null) => void;
  togglePathSelection: (path: string) => void;
  addToSelection: (path: string) => void;
  selectRange: (startPath: string, endPath: string) => void;
  clearSelection: () => void;
  // UX-28: passed down so items can accept AI chat message drops on
  // folders (create new file) or files (append with `---` separator).
  onDropAIMessage:
    | ((opts: { content: string; targetFolder: string; existingFilePath?: string }) => Promise<void>)
    | undefined;
  rootPath: string | null;
}

function FileTreeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  selectedPaths,
  lastSelectedPath,
  onSelect,
  onToggle,
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  onSetLetterheadTemplate,
  dragOverPath,
  setDragOverPath,
  togglePathSelection,
  addToSelection,
  selectRange,
  clearSelection,
  onDropAIMessage,
  rootPath,
}: FileTreeItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isSelected = selectedPath === node.path;
  const isMultiSelected = selectedPaths.has(node.path);
  const isExpanded = expandedPaths.has(node.path);
  const isFolder = node.type === 'folder';
  const isDragOver = dragOverPath === node.path;
  // WS-PRIV: a file's privilege status drives the row indicator. Folders are
  // not tagged (privilege is per-source); the indicator renders nothing for them.
  const privilege = usePrivilegeForSource(isFolder ? null : node.path);

  // Single click: select + open files, toggle folders
  // With Ctrl/Cmd: toggle selection
  // With Shift: range selection
  const handleClick = useCallback(async (e: React.MouseEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrlOrCmd) {
      // Ctrl/Cmd+Click: toggle this item in multi-selection
      e.preventDefault();
      togglePathSelection(node.path);
    } else if (isShift && lastSelectedPath) {
      // Shift+Click: select range from last selected to this item
      e.preventDefault();
      selectRange(lastSelectedPath, node.path);
    } else {
      // Normal click: single selection
      clearSelection();
      onSelect(node.path);
      if (isFolder) {
        onToggle(node.path);
      } else {
        // Open file on single click for better UX
        await onFileOpen(node.path, node.name);
      }
    }
  }, [node.path, node.name, isFolder, onSelect, onToggle, onFileOpen, togglePathSelection, selectRange, clearSelection, lastSelectedPath]);

  const handleDoubleClick = useCallback(async () => {
    // Double-click also opens files (for consistency)
    if (!isFolder) {
      await onFileOpen(node.path, node.name);
    }
  }, [node, isFolder, onFileOpen]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isFolder) {
          onToggle(node.path);
        } else {
          await onFileOpen(node.path, node.name);
        }
      } else if (e.key === 'ArrowRight' && isFolder && !isExpanded) {
        onToggle(node.path);
      } else if (e.key === 'ArrowLeft' && isFolder && isExpanded) {
        onToggle(node.path);
      }
    },
    [node, isFolder, isExpanded, onToggle, onFileOpen]
  );

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // If dragging a multi-selected item, drag all selected items
      // Otherwise, just drag this single item
      if (selectedPaths.has(node.path) && selectedPaths.size > 1) {
        // Dragging multiple items
        const pathsArray = Array.from(selectedPaths);
        e.dataTransfer.setData('text/plain', JSON.stringify(pathsArray));
        e.dataTransfer.setData('multi-drag', 'true');
      } else {
        // Dragging single item
        e.dataTransfer.setData('text/plain', node.path);
      }
      e.dataTransfer.effectAllowed = 'move';
      setIsDragging(true);
    },
    [node.path, selectedPaths]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragOverPath(null);
  }, [setDragOverPath]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // UX-28: AI chat message drops can land on EITHER folders (create a
      // new file) or files (append to existing). For non-AI drags, keep
      // the original behaviour of only lighting up folders.
      const types = Array.from(e.dataTransfer.types);
      const isAIMessage = types.includes(AI_MESSAGE_MIME);

      if (!isAIMessage && !isFolder) return;

      e.dataTransfer.dropEffect = isAIMessage ? 'copy' : 'move';
      setDragOverPath(node.path);
    },
    [isFolder, node.path, setDragOverPath]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      // Only clear if we're actually leaving this element
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        if (dragOverPath === node.path) {
          setDragOverPath(null);
        }
      }
    },
    [dragOverPath, node.path, setDragOverPath]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverPath(null);

      // UX-28: first, try the AI-chat-message MIME. Folder drops create a
      // new file; file drops append to the existing file.
      const aiMessage = e.dataTransfer.getData(AI_MESSAGE_MIME);
      if (aiMessage && onDropAIMessage) {
        if (isFolder) {
          await onDropAIMessage({ content: aiMessage, targetFolder: node.path });
        } else {
          // Dropped onto a file — append with a separator. Fall back to
          // the parent folder if we can't compute one.
          const parent = node.path.substring(0, node.path.lastIndexOf('/'));
          await onDropAIMessage({
            content: aiMessage,
            targetFolder: parent || rootPath || node.path,
            existingFilePath: node.path,
          });
        }
        return;
      }

      if (!isFolder || !onMove) return;

      const isMultiDrag = e.dataTransfer.getData('multi-drag') === 'true';
      const dataStr = e.dataTransfer.getData('text/plain');

      if (!dataStr) return;

      if (isMultiDrag) {
        // Handle multi-item drop
        try {
          const sourcePaths: string[] = JSON.parse(dataStr);

          // Validate: Don't allow dropping into any of the selected items or their descendants
          const isInvalidDrop = sourcePaths.some(path => {
            return path === node.path || node.path.startsWith(path + '/');
          });

          if (isInvalidDrop) return;

          // Move all items
          for (const sourcePath of sourcePaths) {
            await onMove(sourcePath, node.path);
          }

          // Clear selection after successful multi-move
          clearSelection();
        } catch (error) {
          console.error('Failed to parse multi-drag data:', error);
        }
      } else {
        // Handle single-item drop
        const sourcePath = dataStr;
        if (sourcePath === node.path) return;

        // Don't allow dropping a folder into itself or its descendants
        if (node.path.startsWith(sourcePath + '/')) return;

        await onMove(sourcePath, node.path);
      }
    },
    [isFolder, node.path, onMove, setDragOverPath, clearSelection, onDropAIMessage, rootPath]
  );

  // UX-37: single source of truth for per-extension file icons.
  // Derive extension from the file name (not node.extension) because the
  // TauriFSBackend does not populate the extension field on FileNode.
  const renderFileIcon = () => {
    if (isFolder) {
      return isExpanded ? (
        <FolderOpen className="h-4 w-4 text-amber-500" />
      ) : (
        <Folder className="h-4 w-4 text-amber-500" />
      );
    }
    const ext = node.name.split('.').pop()?.toLowerCase();
    const { Icon, color } = getFileIcon(ext);
    return <Icon className={`h-4 w-4 ${color}`} />;
  };

  return (
    <div>
      <div
        // UX-19: folders tag their path so the global drop handler can route
        // an external file drop into this folder. Uses `data-folder-path` —
        // read by `findFolderTarget` in GlobalDropOverlay.
        {...(isFolder ? { 'data-folder-path': node.path } : {})}
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded-sm transition-colors border border-transparent',
          isSelected && 'bg-accent',
          isMultiSelected && 'bg-primary/30 !border-primary',
          !isSelected && !isMultiSelected && !isDragOver && 'hover:bg-muted/50',
          isDragging && 'opacity-50',
          isDragOver && isFolder && 'bg-primary/20 !border-2 !border-dashed !border-primary'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        tabIndex={0}
        role="treeitem"
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isSelected || isMultiSelected}
        aria-multiselectable="true"
      >
        {/* Expand/Collapse chevron for folders */}
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
          {isFolder && (
            isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          )}
        </span>

        {/* Icon */}
        <span className="flex-shrink-0">{renderFileIcon()}</span>

        {/* Name */}
        <span className="flex-1 truncate text-sm">{node.name}</span>

        {/* F2.4: a folder whose contents couldn't be read (permission denied,
            an offline network/OneDrive location) shows a warning instead of
            silently looking like an ordinary empty folder. */}
        {isFolder && node.readError && (
          <span
            data-testid="folder-read-error"
            title="Couldn't read this folder. It may be a permission issue, or a network/OneDrive location that is offline."
            className="flex-shrink-0 text-amber-600"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}

        {/* WS-PRIV: privilege indicator (files only; renders nothing for "none"). */}
        {!isFolder && (
          <PrivilegeIndicator privilege={privilege} compact className="mr-1 shrink-0" />
        )}

        {/* Context menu - always rendered but invisible when not hovered to prevent layout shift */}
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="File options"
              className={cn(
                "h-6 w-6 p-0 flex-shrink-0",
                !isHovered && !isMenuOpen && "opacity-0 pointer-events-none"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {isFolder && (
                <>
                  <DropdownMenuItem onClick={() => { onCreateFile?.(node.path); setIsMenuOpen(false); }}>
                    New File
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { onCreateFolder?.(node.path); setIsMenuOpen(false); }}>
                    New Folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => { onRename?.(node.path); setIsMenuOpen(false); }}>
                Rename
              </DropdownMenuItem>
              {!isFolder && (
                <DropdownMenuItem onClick={() => { onDownload?.(node.path, node.name); setIsMenuOpen(false); }}>
                  <Download className="h-3.5 w-3.5 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              {/* VG-4c: pick this Word file as the firm letterhead template.
                  New documents and workflow deliverables start from it. */}
              {!isFolder &&
                onSetLetterheadTemplate &&
                node.name.toLowerCase().endsWith('.docx') && (
                  <DropdownMenuItem
                    data-testid="use-as-letterhead"
                    onClick={() => { onSetLetterheadTemplate(node.path); setIsMenuOpen(false); }}
                  >
                    <FileText className="h-3.5 w-3.5 mr-2" />
                    Use as letterhead template
                  </DropdownMenuItem>
                )}
              {/* WS-PRIV: tag this file's privilege. Files only — privilege is
                  per-source. Changing it re-tags the file's indexed chunks so it
                  is excluded from AI retrieval by default. */}
              {!isFolder && (
                <>
                  <DropdownMenuSeparator />
                  <PrivilegeMenuItems
                    sourceId={node.path}
                    onChanged={() => setIsMenuOpen(false)}
                  />
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { onDelete?.(node.path); setIsMenuOpen(false); }}
                className="text-destructive focus:text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>

      {/* Children (if folder and expanded) */}
      {isFolder && isExpanded && node.children && (
        <div role="group">
          {visibleNodes(node.children).map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              selectedPaths={selectedPaths}
              lastSelectedPath={lastSelectedPath}
              onSelect={onSelect}
              onToggle={onToggle}
              onFileOpen={onFileOpen}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              onDownload={onDownload}
              onSetLetterheadTemplate={onSetLetterheadTemplate}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              togglePathSelection={togglePathSelection}
              addToSelection={addToSelection}
              selectRange={selectRange}
              clearSelection={clearSelection}
              onDropAIMessage={onDropAIMessage}
              rootPath={rootPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default FileTree;
