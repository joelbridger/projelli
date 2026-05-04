// Search Panel Component
// Provides intelligent, deep search across all workspace content

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { EmptyState } from '@/components/common/EmptyState';
import type { FileNode } from '@/types/workspace';
import type { ContentSearchResult } from '@/modules/search/ContentIndex';

interface SearchResult {
  path: string;
  name: string;
  type: 'file' | 'folder' | 'chat' | 'whiteboard';
  preview?: string;
  matches: number;
  /** UX-26: the snippet of content around the first match. Only set when
   *  the result came from the content index, not just filename matching. */
  snippet?: string;
  matchedTerm?: string;
}

interface SearchPanelProps {
  onFileSelect?: (path: string, name: string) => void;
  onRevealInFolder?: (path: string) => void;
  /**
   * UX-26: optional content search function. When provided, content-index
   * hits are merged with filename hits for a single unified result list.
   * Callers pass a reference to the `useContentIndex` hook's `search`.
   */
  onContentSearch?: (query: string) => ContentSearchResult[];
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
 * UX-26: Render a content snippet with the matching term wrapped in a
 * `<mark>` tag. We split on a case-insensitive exact-term boundary so the
 * highlight survives the fuzzy-match miss.
 */
function renderSnippetWithHighlight(snippet: string, term?: string): React.ReactNode {
  if (!term) return snippet;
  const lowerSnippet = snippet.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const idx = lowerSnippet.indexOf(lowerTerm);
  if (idx === -1) return snippet;
  const before = snippet.slice(0, idx);
  const hit = snippet.slice(idx, idx + term.length);
  const after = snippet.slice(idx + term.length);
  return (
    <>
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-900/60 text-foreground rounded px-0.5">
        {hit}
      </mark>
      {after}
    </>
  );
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

export function SearchPanel({ onFileSelect, onRevealInFolder, onContentSearch, className }: SearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // UX-26: separate debounced query fuels the content index so we don't
  // re-run every keystroke on a 10k-file index. 150ms feels instant in the
  // hand yet lets stronger signals consolidate.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const { fileTree, setExpandedPaths, expandedPaths, selectPath } = useWorkspaceStore();

  // Debounce the query → debouncedQuery propagation on a 150ms timer.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  // Perform search with file type filtering
  const results = useMemo(() => {
    if (!query.trim()) {
      return [];
    }

    // Filename matches (the original search path).
    const nameResults = searchFileTree(fileTree, query);

    // UX-26: content matches. We key the content lookup on the debounced
    // value so results stabilise while the user is typing quickly.
    const contentMatches: SearchResult[] = [];
    if (onContentSearch && debouncedQuery.trim()) {
      const byPath = new Set(nameResults.map((r) => r.path));
      const contentHits = onContentSearch(debouncedQuery.trim());
      for (const hit of contentHits) {
        if (byPath.has(hit.path)) continue; // Already in name matches
        const ext = hit.name.split('.').pop()?.toLowerCase();
        let type: SearchResult['type'] = 'file';
        if (ext === 'aichat') type = 'chat';
        else if (ext === 'whiteboard') type = 'whiteboard';
        contentMatches.push({
          path: hit.path,
          name: hit.name,
          type,
          matches: 1,
          snippet: hit.snippet,
          ...(hit.matchedTerm ? { matchedTerm: hit.matchedTerm } : {}),
        });
      }
    }

    const allResults = [...nameResults, ...contentMatches];

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
  }, [fileTree, query, debouncedQuery, fileTypeFilter, onContentSearch]);

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
            data-testid="search-input"
            type="text"
            placeholder="Search filenames and content..."
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
            <DropdownMenuLabel>{t('search.filter-by-type')}</DropdownMenuLabel>
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
            <p>{t('search.no-results')}</p>
          </div>
        )}

        {!query && (
          <EmptyState
            panelName="search"
            icon={Search}
            title="Search your workspace"
            description="Find files, folders, AI chats, and whiteboards by name. Filter by file type above to narrow results."
          />
        )}

        {results.length > 0 && (
          <div data-testid="search-results" className="py-2">
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
                  data-testid={`search-result-${index}`}
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
                      {/* UX-26: content snippet — only present when the
                          result was produced by the MiniSearch index. */}
                      {result.snippet && (
                        <div
                          data-testid={`search-result-${index}-snippet`}
                          className="text-xs text-muted-foreground/90 mt-1 line-clamp-2"
                        >
                          {renderSnippetWithHighlight(result.snippet, result.matchedTerm)}
                        </div>
                      )}
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
          <div className="rounded-md border border-primary/30 bg-primary/5 p-2 mb-2 text-foreground/80">
            <span className="font-medium">Tip:</span> Press{' '}
            <kbd className="px-1.5 py-0.5 rounded bg-muted text-[11px] font-mono">Ctrl+P</kbd>{' '}
            {t('search.tip-quick-open')}
          </div>
          <div>{t('search.tip-content')}</div>
          <div>{t('search.tip-formats')}</div>
          <div>{t('search.tip-snippet')}</div>
        </div>
      )}
    </div>
  );
}

export default SearchPanel;
