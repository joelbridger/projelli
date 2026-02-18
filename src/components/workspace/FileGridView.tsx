// File Grid View Component
// Displays workspace files and folders in a grid layout with breadcrumb navigation

import { useState, useCallback, useMemo } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';
import {
  Folder,
  File,
  FileText,
  FileImage,
  FileVideo,
  FileJson,
  ChevronRight,
  Home,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FileGridViewProps {
  onFileOpen: (path: string, name: string) => Promise<void>;
  onMove?: (sourcePath: string, targetPath: string) => Promise<void>;
  className?: string;
}

export function FileGridView({
  onFileOpen,
  onMove,
  className,
}: FileGridViewProps) {
  const { fileTree, rootPath } = useWorkspaceStore();
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [dragOverBreadcrumbIndex, setDragOverBreadcrumbIndex] = useState<number | null>(null);

  // Get current folder contents
  const currentContents = useMemo(() => {
    let nodes = fileTree;
    for (const segment of currentPath) {
      const folder = nodes.find(
        (n) => n.name === segment && n.type === 'folder'
      );
      if (folder?.children) {
        nodes = folder.children;
      } else {
        return [];
      }
    }
    return nodes;
  }, [fileTree, currentPath]);

  // Navigate into a folder
  const handleFolderClick = useCallback((folderName: string) => {
    setCurrentPath((prev) => [...prev, folderName]);
  }, []);

  // Navigate via breadcrumb
  const handleBreadcrumbClick = useCallback((index: number) => {
    if (index === -1) {
      // Go to root
      setCurrentPath([]);
    } else {
      // Go to specific breadcrumb level
      setCurrentPath((prev) => prev.slice(0, index + 1));
    }
  }, []);

  // Handle file click
  const handleFileClick = useCallback(
    async (file: FileNode) => {
      await onFileOpen(file.path, file.name);
    },
    [onFileOpen]
  );

  // Get icon for file type
  const getFileIcon = (node: FileNode) => {
    // Bigger icons for better visibility in smaller squares
    const iconClass = "h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16";

    if (node.type === 'folder') {
      return <Folder className={`${iconClass} text-blue-500`} />;
    }

    const ext = node.extension?.toLowerCase();
    if (ext === 'md' || ext === 'txt') {
      return <FileText className={`${iconClass} text-gray-600`} />;
    }
    if (ext === 'json') {
      return <FileJson className={`${iconClass} text-orange-500`} />;
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext || '')) {
      return <FileImage className={`${iconClass} text-green-500`} />;
    }
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext || '')) {
      return <FileVideo className={`${iconClass} text-purple-500`} />;
    }
    return <File className={`${iconClass} text-gray-500`} />;
  };

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, node: FileNode) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.path);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, node: FileNode) => {
      if (node.type === 'folder') {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverPath(node.path);
      }
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    setDragOverPath(null);
  }, []);

  // Breadcrumb drag handlers - allow dropping files onto breadcrumbs to move them
  const handleBreadcrumbDragOver = useCallback(
    (e: React.DragEvent, breadcrumbIndex: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverBreadcrumbIndex(breadcrumbIndex);
    },
    []
  );

  const handleBreadcrumbDragLeave = useCallback(() => {
    setDragOverBreadcrumbIndex(null);
  }, []);

  const handleBreadcrumbDrop = useCallback(
    async (e: React.DragEvent, breadcrumbIndex: number) => {
      e.preventDefault();
      const sourcePath = e.dataTransfer.getData('text/plain');

      if (sourcePath && onMove && rootPath) {
        // Build target path from breadcrumb segments
        let targetPath: string;
        if (breadcrumbIndex === -1) {
          // Dropping on "Root" - move to root folder
          targetPath = rootPath;
        } else {
          // Dropping on a specific breadcrumb segment
          targetPath = rootPath + '/' + currentPath.slice(0, breadcrumbIndex + 1).join('/');
        }

        // Don't move to same location
        const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
        if (sourceDir !== targetPath) {
          await onMove(sourcePath, targetPath);
        }
      }

      setDragOverBreadcrumbIndex(null);
    },
    [onMove, rootPath, currentPath]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetNode: FileNode) => {
      e.preventDefault();
      const sourcePath = e.dataTransfer.getData('text/plain');

      if (
        sourcePath &&
        targetNode.type === 'folder' &&
        onMove &&
        sourcePath !== targetNode.path
      ) {
        await onMove(sourcePath, targetNode.path);
      }

      setDragOverPath(null);
    },
    [onMove]
  );

  return (
    <div data-testid="file-grid-view" className={cn('flex flex-col h-full', className)}>
      {/* Breadcrumb Navigation - supports drag-drop to move files */}
      <div data-testid="breadcrumb-nav" className="flex items-center gap-1 px-4 py-3 border-b bg-muted/30">
        <Button
          data-testid="breadcrumb-root"
          variant="ghost"
          size="sm"
          onClick={() => handleBreadcrumbClick(-1)}
          onDragOver={(e) => handleBreadcrumbDragOver(e, -1)}
          onDragLeave={handleBreadcrumbDragLeave}
          onDrop={(e) => handleBreadcrumbDrop(e, -1)}
          className={cn(
            "h-7 px-2 gap-1 transition-colors",
            dragOverBreadcrumbIndex === -1 && "bg-primary/20 border-primary"
          )}
        >
          <Home className="h-4 w-4" />
          <span className="text-sm">Root</span>
        </Button>

        {currentPath.map((segment, index) => (
          <div key={index} className="flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Button
              data-testid={`breadcrumb-${index}`}
              variant="ghost"
              size="sm"
              onClick={() => handleBreadcrumbClick(index)}
              onDragOver={(e) => handleBreadcrumbDragOver(e, index)}
              onDragLeave={handleBreadcrumbDragLeave}
              onDrop={(e) => handleBreadcrumbDrop(e, index)}
              className={cn(
                "h-7 px-2 transition-colors",
                dragOverBreadcrumbIndex === index && "bg-primary/20 border-primary"
              )}
            >
              <span className="text-sm">{segment}</span>
            </Button>
          </div>
        ))}
      </div>

      {/* Grid View */}
      <div className="flex-1 overflow-auto p-6">
        {currentContents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Folder className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">Empty folder</p>
              <p className="text-sm">This folder contains no files or subfolders</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 xs:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12 gap-2 sm:gap-3">
            {currentContents.map((node) => (
              <div
                key={node.path}
                data-testid={`grid-item-${node.name}`}
                draggable
                onDragStart={(e) => handleDragStart(e, node)}
                onDragOver={(e) => handleDragOver(e, node)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, node)}
                onClick={() => {
                  if (node.type === 'folder') {
                    handleFolderClick(node.name);
                  } else {
                    handleFileClick(node);
                  }
                }}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 p-2 rounded-lg border-2 cursor-pointer transition-all hover:bg-muted/50 hover:border-primary/50 hover:shadow-md aspect-square',
                  dragOverPath === node.path &&
                    node.type === 'folder' &&
                    'border-primary bg-primary/10 shadow-lg',
                  'group'
                )}
              >
                <div className="flex-shrink-0">{getFileIcon(node)}</div>
                <span className="text-xs text-center break-words w-full line-clamp-2 font-medium">
                  {node.name}
                </span>
                {node.type === 'file' && node.extension && (
                  <span className="text-[10px] text-muted-foreground">
                    .{node.extension}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileGridView;
