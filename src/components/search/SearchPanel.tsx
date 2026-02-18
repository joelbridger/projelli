// Search Panel Component
// Provides intelligent, deep search across all workspace content

import { useState, useCallback, useMemo } from 'react';
import { Search, FileText, FolderOpen, MessageSquare, PenTool, X, FolderTree, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';

interface SearchResult {
  path: string;
  name: string;
  type: 'file' | 'folder' | 'chat' | 'whiteboard';
  preview?: string;
  matches: number;
}

interface SearchPanelProps {
  onFileSelect?: (path: string, name: string) => void;
  onRevealInFolder?: (path: string) => void;
  className?: string;
}

/**
 * Recursively search through file tree
 */
function searchFileTree(
  nodes: FileNode[],
  query: string,
  results: SearchResult[] = []
): SearchResult[] {
  const lowerQuery = query.toLowerCase();

  for (const node of nodes) {
    // Check if name matches
    const nameMatches = node.name.toLowerCase().includes(lowerQuery);

    if (nameMatches) {
      // Determine type based on extension or node type
      let type: SearchResult['type'] = node.type;
      if (node.type === 'file') {
        const ext = node.name.split('.').pop()?.toLowerCase();
        if (ext === 'aichat') {
          type = 'chat';
        } else if (ext === 'whiteboard') {
          type = 'whiteboard';
        }
      }

      results.push({
        path: node.path,
        name: node.name,
        type,
        matches: 1,
      });
    }

    // Recursively search children
    if (node.children && node.children.length > 0) {
      searchFileTree(node.children, query, results);
    }
  }

  return results;
}

/**
 * Get icon for search result type
 */
function getResultIcon(type: SearchResult['type']) {
  switch (type) {
    case 'folder':
      return <FolderOpen className="h-4 w-4 text-blue-500" />;
    case 'chat':
      return <MessageSquare className="h-4 w-4 text-green-500" />;
    case 'whiteboard':
      return <PenTool className="h-4 w-4 text-purple-500" />;
    default:
      return <FileText className="h-4 w-4 text-muted-foreground" />;
  }
}

type FileTypeFilter = 'all' | 'markdown' | 'text' | 'image' | 'video' | 'audio' | 'whiteboard' | 'chat' | 'source' | 'json';

const FILE_TYPE_FILTERS: { value: FileTypeFilter; label: string; extensions: string[] }[] = [
  { value: 'all', label: 'All Files', extensions: [] },
  { value: 'markdown', label: 'Markdown', extensions: ['md', 'markdown'] },
  { value: 'text', label: 'Text', extensions: ['txt'] },
  { value: 'image', label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
  { value: 'video', label: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi'] },
  { value: 'audio', label: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
  { value: 'whiteboard', label: 'Whiteboards', extensions: ['whiteboard'] },
  { value: 'chat', label: 'AI Chats', extensions: ['aichat'] },
  { value: 'source', label: 'Sources', extensions: ['source'] },
  { value: 'json', label: 'JSON', extensions: ['json'] },
];

export function SearchPanel({ onFileSelect, onRevealInFolder, className }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const { fileTree, setExpandedPaths, expandedPaths, selectPath } = useWorkspaceStore();

  // Perform search with file type filtering
  const results = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    const allResults = searchFileTree(fileTree, query);

    // Apply file type filter
    if (fileTypeFilter === 'all') {
      return allResults;
    }

    const filter = FILE_TYPE_FILTERS.find((f) => f.value === fileTypeFilter);
    if (!filter) {
      return allResults;
    }

    return allResults.filter((result) => {
      if (result.type === 'folder') {
        return false; // Don't include folders when filtering by type
      }

      const ext = result.name.split('.').pop()?.toLowerCase();
      return ext && filter.extensions.includes(ext);
    });
  }, [fileTree, query, fileTypeFilter]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      if (result.type === 'folder') {
        // For folders, expand and reveal in Files tab
        const parts = result.path.split('/');
        const newExpanded = new Set(expandedPaths);

        // Add the folder and all its parent paths to expanded set
        for (let i = 1; i <= parts.length; i++) {
          const folderPath = parts.slice(0, i).join('/');
          newExpanded.add(folderPath);
        }

        setExpandedPaths(newExpanded);
        selectPath(result.path);

        // Notify parent to switch to Files tab
        if (onRevealInFolder) {
          onRevealInFolder(result.path);
        }
      } else if (onFileSelect) {
        // For files, open them
        onFileSelect(result.path, result.name);
      }
    },
    [onFileSelect, onRevealInFolder, expandedPaths, setExpandedPaths, selectPath]
  );

  const handleRevealInFolder = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();

      // Expand all parent folders
      const parts = path.split('/');
      const newExpanded = new Set(expandedPaths);

      // Add all parent folder paths to expanded set
      for (let i = 1; i < parts.length - 1; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        newExpanded.add(folderPath);
      }

      setExpandedPaths(newExpanded);
      selectPath(path);

      // Notify parent to switch to Files tab
      if (onRevealInFolder) {
        onRevealInFolder(path);
      }
    },
    [expandedPaths, setExpandedPaths, selectPath, onRevealInFolder]
  );

  const handleClearSearch = useCallback(() => {
    setQuery('');
  }, []);

  const activeFilter = FILE_TYPE_FILTERS.find((f) => f.value === fileTypeFilter);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Search input */}
      <div className="p-3 border-b space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search files, chats, whiteboards..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 pr-8 h-9 text-sm"
            autoFocus
          />
          {query && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-9 w-9 p-0 hover:bg-transparent"
              onClick={handleClearSearch}
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* File type filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-full justify-start gap-2 text-sm">
              <Filter className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{activeFilter?.label || 'All Files'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[200px]">
            <DropdownMenuLabel>Filter by file type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {FILE_TYPE_FILTERS.map((filter) => (
              <DropdownMenuCheckboxItem
                key={filter.value}
                checked={fileTypeFilter === filter.value}
                onCheckedChange={() => setFileTypeFilter(filter.value)}
              >
                {filter.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search results */}
      <div className="flex-1 overflow-auto">
        {query && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
            <Search className="h-8 w-8 mb-2 opacity-50" />
            <p>No results found</p>
          </div>
        )}

        {!query && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm px-4 text-center">
            <Search className="h-8 w-8 mb-2 opacity-50" />
            <p>Search across all workspace content</p>
            <p className="text-xs mt-1">Files, folders, chats, and whiteboards</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="py-2">
            <div className="px-3 py-1 text-xs text-muted-foreground">
              {results.length} {results.length === 1 ? 'result' : 'results'}
              {fileTypeFilter !== 'all' && (
                <span className="ml-1">
                  ({activeFilter?.label})
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              {results.map((result, index) => (
                <div
                  key={`${result.path}-${index}`}
                  className={cn(
                    'group relative w-full px-3 py-2 flex items-start gap-2 hover:bg-accent transition-colors cursor-pointer'
                  )}
                >
                  <button
                    className="flex items-start gap-2 flex-1 min-w-0 text-left"
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {getResultIcon(result.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {result.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {result.path.split('/').slice(0, -1).join('/') || '/'}
                      </div>
                    </div>
                  </button>
                  {result.type !== 'folder' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={(e) => handleRevealInFolder(e, result.path)}
                      title="Show in folder tree"
                    >
                      <FolderTree className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Search tips */}
      {!query && (
        <div className="border-t p-3 text-xs text-muted-foreground space-y-1">
          <div className="font-medium mb-2">Search Tips:</div>
          <div>• Search is case-insensitive</div>
          <div>• Results include all file types</div>
          <div>• Click a result to open the file</div>
        </div>
      )}
    </div>
  );
}

export default SearchPanel;
