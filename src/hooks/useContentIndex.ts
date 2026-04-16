/**
 * React hook wrapper around the content-search index (UX-26).
 *
 * Lifecycle:
 *   - Rebuilds from scratch when `rootPath` or the workspace service
 *     reference change (i.e. workspace switch).
 *   - Exposes `upsert` / `remove` so per-file saves can keep the index
 *     current without a full rescan.
 *   - `search(query)` returns the top 30 matches. Results are produced
 *     synchronously from the in-memory index.
 *
 * This is a light wrapper — search UIs import it directly rather than
 * going through a global store; there's only one index per workspace and
 * we want to avoid the subscription noise Zustand would introduce for
 * every tiny save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type MiniSearch from 'minisearch';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { FileNode } from '@/types/workspace';
import {
  buildWorkspaceIndex,
  createIndex,
  searchIndex,
  upsertDocument,
  removeDocument,
  type ContentIndexDocument,
  type ContentSearchResult,
} from '@/modules/search/ContentIndex';

interface UseContentIndexOptions {
  rootPath: string | null;
  service: WorkspaceService | null;
  fileTree: FileNode[];
}

interface UseContentIndexReturn {
  ready: boolean;
  search: (query: string) => ContentSearchResult[];
  upsert: (doc: ContentIndexDocument) => void;
  remove: (id: string) => void;
  /** Manual rebuild trigger. Rare — normally the rootPath effect handles it. */
  rebuild: () => Promise<void>;
}

export function useContentIndex({
  rootPath,
  service,
  fileTree,
}: UseContentIndexOptions): UseContentIndexReturn {
  const indexRef = useRef<MiniSearch<ContentIndexDocument>>(createIndex());
  const [ready, setReady] = useState(false);
  // Track the workspace we built the index for so we can detect when we
  // need to swap. Rebuilding on every fileTree change would be wasteful
  // (saves already `upsert` the current file), but a root-path switch
  // indicates a fresh workspace with a different set of files.
  const builtForSignatureRef = useRef<string | null>(null);

  const rebuild = useCallback(async () => {
    if (!service || !rootPath) {
      indexRef.current = createIndex();
      builtForSignatureRef.current = null;
      setReady(false);
      return;
    }
    try {
      setReady(false);
      const idx = await buildWorkspaceIndex(service, fileTree);
      indexRef.current = idx;
      // Signature is re-computed downstream and written by the effect.
      setReady(true);
    } catch (err) {
      console.error('[useContentIndex] build failed:', err);
      indexRef.current = createIndex();
      setReady(false);
    }
  }, [service, rootPath, fileTree]);

  // Derive a cheap signature of the file tree's shape (path set + rootPath)
  // so we can detect when we actually need to rebuild. A content-save that
  // doesn't change the path list re-renders but doesn't invalidate the
  // signature — per-file updates flow through `upsert`/`remove` instead.
  const treeSignature = useMemo(() => {
    const paths: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file') paths.push(n.path);
        else if (n.children) walk(n.children);
      }
    };
    walk(fileTree);
    return `${rootPath ?? ''}|${paths.length}|${paths.sort().join('\u0001')}`;
  }, [fileTree, rootPath]);

  // Build the index when the workspace OR the set of indexable files
  // changes. Content edits (same path, new bytes) don't bump the signature
  // — those get picked up via `upsert` from the save path.
  useEffect(() => {
    if (!service || !rootPath) {
      indexRef.current = createIndex();
      builtForSignatureRef.current = null;
      setReady(false);
      return;
    }
    if (builtForSignatureRef.current === treeSignature) return;
    builtForSignatureRef.current = treeSignature;
    void rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild depends on mutable refs
  }, [rootPath, service, treeSignature]);

  const search = useCallback(
    (query: string): ContentSearchResult[] => {
      return searchIndex(indexRef.current, query);
    },
    []
  );

  const upsert = useCallback((doc: ContentIndexDocument) => {
    upsertDocument(indexRef.current, doc);
  }, []);

  const remove = useCallback((id: string) => {
    removeDocument(indexRef.current, id);
  }, []);

  return useMemo(
    () => ({ ready, search, upsert, remove, rebuild }),
    [ready, search, upsert, remove, rebuild]
  );
}
