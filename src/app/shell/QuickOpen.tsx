/**
 * Quick-open modal (UX-27)
 *
 * Ctrl+P / Cmd+P opens a fuzzy filename switcher. Matches VS Code / Obsidian
 * semantics: arrow keys navigate, Enter opens, Esc cancels, and recent files
 * show when the input is empty.
 *
 * Implementation notes:
 *   - Fuzzy matching uses `fuse.js` over the flattened file tree. We index
 *     both the filename and the trailing path components so typing "docs"
 *     narrows to files inside a docs folder.
 *   - Recent-files list persists in localStorage keyed by `quickopen:recents`.
 *     Capped at 10 entries. Entries are moved to the top on open.
 *   - The Dialog includes a VISUALLY-HIDDEN DialogTitle to satisfy Radix's
 *     a11y contract (same pattern as the command palette — see UX-02).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Fuse from 'fuse.js';
import { Search, File as FileIcon, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import type { FileNode } from '@/platform/types/workspace';

const RECENTS_STORAGE_KEY = 'quickopen:recents';
const RECENTS_MAX = 10;

export interface QuickOpenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileTree: FileNode[];
  onFileOpen: (path: string, name: string) => void | Promise<void>;
}

interface FlatFile {
  path: string;
  name: string;
  /** Parent folder path (e.g. "docs/guides"), minus the root. */
  folder: string;
}

/**
 * Flatten the file tree to a list of files only (folders excluded). The
 * `folder` value is used for display only — matching happens on `name` +
 * `path` per fuse.js's config below.
 */
function flattenFiles(nodes: FileNode[], prefix = ''): FlatFile[] {
  const out: FlatFile[] = [];
  for (const node of nodes) {
    if (node.type === 'folder' && node.children) {
      const nextPrefix = prefix ? `${prefix}/${node.name}` : node.name;
      out.push(...flattenFiles(node.children, nextPrefix));
    } else if (node.type === 'file') {
      out.push({
        path: node.path,
        name: node.name,
        folder: prefix,
      });
    }
  }
  return out;
}

function loadRecents(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed.slice(0, RECENTS_MAX);
    }
  } catch {
    // Ignore corrupted entries
  }
  return [];
}

function pushRecent(path: string): string[] {
  const existing = loadRecents().filter((p) => p !== path);
  const next = [path, ...existing].slice(0, RECENTS_MAX);
  try {
    localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore write errors (storage full / private mode).
  }
  return next;
}

export function QuickOpen({ open, onOpenChange, fileTree, onFileOpen }: QuickOpenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flatten the tree once per fileTree change. We rebuild the Fuse index from
  // this list so matching is consistent with the current workspace shape.
  const files = useMemo(() => flattenFiles(fileTree), [fileTree]);

  const fuse = useMemo(
    () =>
      new Fuse(files, {
        keys: [
          { name: 'name', weight: 0.7 },
          { name: 'folder', weight: 0.3 },
        ],
        threshold: 0.4,
        includeScore: false,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [files]
  );

  // Reset state + focus on open; refresh recents so they reflect the latest
  // in-storage order (the list can be modified externally when any other
  // path opens a file).
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setRecents(loadRecents());
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Results: either fuzzy matches (when there's a query) or the recents list
  // (when the query is empty). Both get clipped to 20 entries; that's already
  // more than a small dialog needs.
  const results = useMemo<FlatFile[]>(() => {
    const q = query.trim();
    if (!q) {
      // When empty: show recents that still exist in the tree.
      const byPath = new Map(files.map((f) => [f.path, f]));
      return recents
        .map((p) => byPath.get(p))
        .filter((f): f is FlatFile => Boolean(f))
        .slice(0, 20);
    }
    return fuse.search(q, { limit: 20 }).map((r) => r.item);
  }, [query, fuse, recents, files]);

  // Keep the highlighted index in range when results change length.
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (results.length === 0) return 0;
      return Math.min(prev, results.length - 1);
    });
  }, [results.length]);

  // Scroll highlighted item into view on selection change.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const open_ = useCallback(
    async (file: FlatFile) => {
      onOpenChange(false);
      setRecents(pushRecent(file.path));
      await onFileOpen(file.path, file.name);
    },
    [onFileOpen, onOpenChange]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter': {
          event.preventDefault();
          const file = results[selectedIndex];
          if (file) {
            void open_(file);
          }
          break;
        }
        case 'Escape':
          event.preventDefault();
          onOpenChange(false);
          break;
      }
    },
    [results, selectedIndex, onOpenChange, open_]
  );

  const showingRecents = !query.trim() && recents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="quick-open-modal"
        className="p-0 max-w-lg overflow-hidden [&>button]:hidden"
      >
        {/* Accessible title and description for screen readers — kept visually
            hidden so the modal matches the command palette's compact look. */}
        <DialogTitle className="sr-only">Quick open</DialogTitle>
        <DialogDescription className="sr-only">
          {t('quick-open.description')}
        </DialogDescription>

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Input
            ref={inputRef}
            data-testid="quick-open-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file..."
            className="border-0 p-0 h-auto focus-visible:ring-0"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
            esc
          </kbd>
        </div>

        {/* Result list */}
        <div ref={listRef} className="max-h-[400px] overflow-auto py-2">
          {results.length === 0 ? (
            <div
              data-testid="quick-open-empty"
              className="px-4 py-8 text-center text-muted-foreground"
            >
              <FileIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                {query.trim() ? 'No files match' : 'No recent files — start typing'}
              </p>
            </div>
          ) : (
            <>
              {showingRecents && (
                <div className="px-4 py-1 flex items-center gap-1.5 text-xs text-muted-foreground uppercase">
                  <Clock className="h-3 w-3" />
                  Recent
                </div>
              )}
              {results.map((file, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <button
                    key={file.path}
                    data-testid={`quick-open-result-${index}`}
                    data-index={index}
                    onClick={() => open_(file)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full px-4 py-2 flex items-center gap-3 text-left',
                      'hover:bg-muted/50',
                      isSelected && 'bg-muted'
                    )}
                  >
                    <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{file.name}</div>
                      {file.folder && (
                        <div className="text-xs text-muted-foreground truncate">
                          {file.folder}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default QuickOpen;
