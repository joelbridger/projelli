// File Tree Component
// Displays workspace folder structure with expand/collapse and context menus

import { useState, useCallback } from 'react';
import type { FileNode } from '@/types/workspace';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FileText,
  FileJson,
  FileImage,
  FileVideo,
  Music,
  MoreVertical,
  FilePlus,
  FolderPlus,
  Upload,
  PenTool,
  Download,
  BookOpen,
  Grid3x3,
  Mic,
  MessageSquare,
  ExternalLink,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface FileTreeProps {
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile?: (parentPath: string, extension?: string) => void;
  onCreateFolder?: (parentPath: string) => void;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
  onDownload?: (path: string, name: string) => void;
  onCreateFileAtRoot?: (extension?: string) => void;
  onCreateMarkdownAtRoot?: () => void;
  onCreateTextFileAtRoot?: () => void;
  onCreateSourceFileAtRoot?: () => void;
  onCreateFolderAtRoot?: () => void;
  onUploadFiles?: (files: FileList, targetFolder?: string) => Promise<void>;
  onCreateWhiteboard?: (parentPath: string) => void;
  onCreateWhiteboardAtRoot?: () => void;
  onOpenGridView?: () => void;
  onCreateAudioAtRoot?: () => void;
}

export function FileTree({
  onFileOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  onMove,
  onDownload,
  onCreateMarkdownAtRoot,
  onCreateTextFileAtRoot,
  onCreateSourceFileAtRoot,
  onCreateFolderAtRoot,
  onUploadFiles,
  onCreateWhiteboard,
  onCreateWhiteboardAtRoot,
  onOpenGridView,
  onCreateAudioAtRoot,
}: FileTreeProps) {
  const {
    fileTree,
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
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

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

      if (!onMove || !rootPath) return;

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
    [onMove, rootPath, clearSelection]
  );

  const handleOpenInExplorer = useCallback(async () => {
    if (!rootPath) return;

    try {
      // Check if we're in Tauri environment
      if (typeof window !== 'undefined' && '__TAURI__' in window) {
        // Use Tauri v2 shell plugin to open folder
        const { open } = await import('@tauri-apps/plugin-shell');
        // If a folder is selected, open that folder; otherwise open root
        const pathToOpen = selectedPath || rootPath;
        await open(pathToOpen);
      } else {
        // Fallback for browser - just show an alert
        alert('This feature is only available in the desktop app.');
      }
    } catch (error) {
      console.error('Failed to open in explorer:', error);
      alert(`Failed to open folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [rootPath, selectedPath]);

  // Multi-select batch operations
  const handleBatchDelete = useCallback(async () => {
    if (!onDelete || selectedPaths.size === 0) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete ${selectedPaths.size} item(s)?`
    );

    if (!confirmed) return;

    // Delete all selected items
    const pathsToDelete = Array.from(selectedPaths);
    for (const path of pathsToDelete) {
      await onDelete(path);
    }

    clearSelection();
  }, [selectedPaths, onDelete, clearSelection]);

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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar with create buttons */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
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
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuItem onClick={onCreateMarkdownAtRoot}>
              <FileText className="h-3.5 w-3.5 mr-2" />
              Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateTextFileAtRoot}>
              <File className="h-3.5 w-3.5 mr-2" />
              Plain Text (.txt)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateSourceFileAtRoot}>
              <BookOpen className="h-3.5 w-3.5 mr-2" />
              Source (.source)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateWhiteboardAtRoot}>
              <PenTool className="h-3.5 w-3.5 mr-2" />
              Whiteboard
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreateAudioAtRoot}>
              <Mic className="h-3.5 w-3.5 mr-2" />
              Audio File (.webm)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onCreateFolderAtRoot}
          title="New folder at root"
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
              input.accept = 'image/*,video/*,.md,.txt,.json,.pdf,.whiteboard';
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files;
                if (files && files.length > 0) {
                  // Upload to selected folder if it's a folder, otherwise to root
                  const targetFolder = selectedPath && fileTree.find(n => n.path === selectedPath && n.type === 'folder')
                    ? selectedPath
                    : rootPath;
                  onUploadFiles(files, targetFolder || undefined);
                }
              };
              input.click();
            }}
            title="Upload files to selected folder or root"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            Upload
          </Button>
        )}
        {onOpenGridView && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onOpenGridView}
            title="Open grid view"
          >
            <Grid3x3 className="h-3.5 w-3.5 mr-1" />
            Grid View
          </Button>
        )}
      </div>

      {/* Multi-select actions bar */}
      {selectedPaths.size > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-primary/10 border-b border-primary">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-primary">
              {selectedPaths.size} item{selectedPaths.size > 1 ? 's' : ''} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={clearSelection}
              title="Clear selection"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {onDownload && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleBatchDownload}
                title="Download selected files"
              >
                <Download className="h-3 w-3 mr-1" />
                Download
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                onClick={handleBatchDelete}
                title="Delete selected items"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </Button>
            )}
          </div>
        </div>
      )}

      {/* File tree content */}
      {fileTree.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground text-center">
          No files in workspace
        </div>
      ) : (
        <div
          className="py-2 min-h-[200px] flex-1 overflow-auto"
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={handleRootDrop}
        >
          {/* Root drop indicator */}
          {dragOverPath === '__root__' && (
            <div className="mx-2 mb-1 px-2 py-1 border-2 border-dashed border-primary rounded bg-primary/10 text-xs text-primary">
              Drop here to move to root
            </div>
          )}
          {fileTree.map((node) => (
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
              onCreateWhiteboard={onCreateWhiteboard}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              togglePathSelection={togglePathSelection}
              addToSelection={addToSelection}
              selectRange={selectRange}
              clearSelection={clearSelection}
            />
          ))}
        </div>
      )}

      {/* Footer with "Open on Desktop" link */}
      {rootPath && (
        <div className="border-t px-2 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-8 text-xs"
            onClick={handleOpenInExplorer}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-2" />
            Open on Desktop
          </Button>
        </div>
      )}
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
  onFileOpen: (path: string, name: string) => Promise<void>;
  onCreateFile: ((parentPath: string) => void) | undefined;
  onCreateFolder: ((parentPath: string) => void) | undefined;
  onRename: ((path: string) => void) | undefined;
  onDelete: ((path: string) => void) | undefined;
  onMove: ((sourcePath: string, targetPath: string) => Promise<void>) | undefined;
  onDownload: ((path: string, name: string) => void) | undefined;
  onCreateWhiteboard: ((parentPath: string) => void) | undefined;
  dragOverPath: string | null;
  setDragOverPath: (path: string | null) => void;
  togglePathSelection: (path: string) => void;
  addToSelection: (path: string) => void;
  selectRange: (startPath: string, endPath: string) => void;
  clearSelection: () => void;
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
  onCreateWhiteboard,
  dragOverPath,
  setDragOverPath,
  togglePathSelection,
  addToSelection,
  selectRange,
  clearSelection,
}: FileTreeItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isSelected = selectedPath === node.path;
  const isMultiSelected = selectedPaths.has(node.path);
  const isExpanded = expandedPaths.has(node.path);
  const isFolder = node.type === 'folder';
  const isDragOver = dragOverPath === node.path;

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
      if (e.key === 'Enter') {
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

      // Only folders can be drop targets
      if (!isFolder) return;

      e.dataTransfer.dropEffect = 'move';
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
    [isFolder, node.path, onMove, setDragOverPath, clearSelection]
  );

  const getFileIcon = () => {
    if (isFolder) {
      return isExpanded ? (
        <FolderOpen className="h-4 w-4 text-amber-500" />
      ) : (
        <Folder className="h-4 w-4 text-amber-500" />
      );
    }

    const ext = node.extension?.toLowerCase();
    switch (ext) {
      case 'md':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case 'json':
        return <FileJson className="h-4 w-4 text-yellow-500" />;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
      case 'webp':
      case 'svg':
        return <FileImage className="h-4 w-4 text-green-500" />;
      case 'mp4':
      case 'webm':
      case 'mov':
      case 'avi':
        return <FileVideo className="h-4 w-4 text-purple-500" />;
      case 'whiteboard':
        return <PenTool className="h-4 w-4 text-orange-500" />;
      case 'mp3':
      case 'wav':
      case 'ogg':
      case 'm4a':
      case 'webm':
        return <Music className="h-4 w-4 text-pink-500" />;
      case 'aichat':
        return <MessageSquare className="h-4 w-4 text-purple-500" />;
      case 'source':
        return <FileText className="h-4 w-4 text-green-500" />;
      case 'txt':
        return <FileText className="h-4 w-4 text-blue-500" />;
      default:
        return <File className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div>
      <div
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
        <span className="flex-shrink-0">{getFileIcon()}</span>

        {/* Name */}
        <span className="flex-1 truncate text-sm">{node.name}</span>

        {/* Context menu - always rendered but invisible when not hovered to prevent layout shift */}
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
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
                  <DropdownMenuItem onClick={() => { onCreateWhiteboard?.(node.path); setIsMenuOpen(false); }}>
                    New Whiteboard
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
          {node.children.map((child) => (
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
              onCreateWhiteboard={onCreateWhiteboard}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
              togglePathSelection={togglePathSelection}
              addToSelection={addToSelection}
              selectRange={selectRange}
              clearSelection={clearSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default FileTree;
