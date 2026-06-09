/**
 * useMemoryWiring — install the M1 RAG indexer for the active workspace.
 *
 * Lifecycle (per workspace open):
 *   1. Wire the MemoryService toggle reader against the persisted setting.
 *   2. Tell the Rust backend which workspace to index (`rag_set_workspace`).
 *   3. Start the workspace file watcher (`watch_workspace`) so the Rust
 *      side emits `workspace-file-changed` events with 200 ms debounce.
 *   4. Subscribe to those events and re-index files on change / drop them
 *      on delete.
 *   5. Kick off a background `rag_index_workspace` so the user's first
 *      query returns hits, even if they haven't edited anything yet.
 *
 * On unmount or workspace switch the watcher subscription is torn down.
 *
 * In browser / test mode (`isTauri()` returns false) every step is a
 * no-op so this hook is safe to mount unconditionally.
 */

import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  isPdfIndexingEnabled,
  MemoryService,
  setMemoryEnabledReader,
  setMatterResolver,
  setPdfIndexingEnabledReader,
} from '@/modules/memory/MemoryService';
import { resolveMatterIdForPath, useMatterStore } from '@/stores/matterStore';
import { isPathInFolder } from '@/modules/memory/matterResolver';
import { createFactsService, type FactsStorage } from '@/modules/memory/FactsService';
import {
  setFactsService,
  setFactsInjectionReader,
  setFactsAutoAcceptReader,
} from '@/modules/memory/factsSingleton';
import {
  watchWorkspace,
  type WorkspaceChangeEvent,
} from '@/utils/tauri-commands';
import { mailSetWorkspace } from '@/utils/mail-commands';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { FileNode } from '@/types/workspace';

/** Build a FactsStorage adapter from a WorkspaceService-shaped object. */
export function buildFactsStorage(
  workspaceService: MemoryWiringWorkspaceService,
  rootPath: string,
): FactsStorage {
  const resolve = (relative: string) =>
    `${rootPath}/${relative}`.replace(/\/+/g, '/');
  return {
    read: (relative) => workspaceService.readFile(resolve(relative)),
    write: (relative, content) =>
      workspaceService.writeFile(resolve(relative), content),
    exists: (relative) => workspaceService.exists(resolve(relative)),
    remove: workspaceService.delete
      ? (relative) => workspaceService.delete!(resolve(relative))
      : async () => {
          /* no-op if delete isn't exposed; stale .tmp is harmless */
        },
  };
}

/** Shape of the workspace service passed to useMemoryWiring.
 *  Requires readFileBinary for A3 PDF indexing in addition to the
 *  existing text-read / write / exists / delete methods. */
export type MemoryWiringWorkspaceService = {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  delete?: (path: string) => Promise<void>;
  /** A3: binary read for PDF extraction. */
  readFileBinary?: (path: string) => Promise<ArrayBuffer>;
};

/** Collect all .pdf paths from a FileNode tree recursively. */
function collectPdfPaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.name.toLowerCase().endsWith('.pdf')) {
      out.push(node.path);
    } else if (node.type === 'folder' && node.children) {
      out.push(...collectPdfPaths(node.children));
    }
  }
  return out;
}

/** Collect every file path in a FileNode tree recursively. */
function collectAllFilePaths(nodes: FileNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      out.push(node.path);
    } else if (node.children) {
      out.push(...collectAllFilePaths(node.children));
    }
  }
  return out;
}

/**
 * WS-B/C — diff two matter lists and return the set of folder paths whose
 * matter assignment changed (added, removed, or moved between matters). When a
 * mapping changes we re-index every file under the affected folders so their
 * chunks pick up the right matter id.
 */
export function changedFolderPaths(
  prev: Array<{ id: string; folderPaths: string[] }>,
  next: Array<{ id: string; folderPaths: string[] }>,
): string[] {
  const before = new Map<string, string>(); // folder -> matterId
  for (const m of prev) for (const f of m.folderPaths) before.set(f, m.id);
  const after = new Map<string, string>();
  for (const m of next) for (const f of m.folderPaths) after.set(f, m.id);

  const changed = new Set<string>();
  for (const [folder, id] of after) {
    if (before.get(folder) !== id) changed.add(folder);
  }
  for (const [folder] of before) {
    if (!after.has(folder)) changed.add(folder); // folder removed from a matter
  }
  return Array.from(changed);
}

/** Walk all .pdf files in the workspace and index them via MemoryService. */
async function indexWorkspacePdfs(
  workspaceService: MemoryWiringWorkspaceService,
): Promise<void> {
  if (!workspaceService.readFileBinary) return;
  const { fileTree } = useWorkspaceStore.getState();
  const pdfPaths = collectPdfPaths(fileTree);
  const binaryWs = {
    readBinary: (path: string) =>
      workspaceService.readFileBinary!(path),
  };
  for (const path of pdfPaths) {
    try {
      await MemoryService.indexPdfFile(path, binaryWs);
    } catch {
      // Best-effort: skip individual failures, continue with the rest.
    }
  }
}

export function useMemoryWiring(
  rootPath: string | null,
  workspaceService?: MemoryWiringWorkspaceService | null,
): void {
  // Wire the toggle readers once. Safe to call repeatedly — last writer wins.
  useEffect(() => {
    setMemoryEnabledReader(() =>
      Boolean(useSettingsStore.getState().getSetting<boolean>('memoryEnabled')),
    );
    // A3 — PDF indexing toggle (default OFF).
    setPdfIndexingEnabledReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
      ),
    );
    // M3 — facts toggles. Injection defaults ON, auto-accept defaults OFF.
    setFactsInjectionReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('factsInjection'),
      ),
    );
    setFactsAutoAcceptReader(() =>
      Boolean(
        useSettingsStore.getState().getSetting<boolean>('factsAutoAccept'),
      ),
    );
    // WS-B/C — install the matter resolver so every indexed chunk is tagged
    // with the matter the file belongs to (or "unassigned").
    setMatterResolver((path) => resolveMatterIdForPath(path));
  }, []);

  // M3 — wire the facts service once the workspace is open so the
  // Settings panel and chat viewer can both read/write `memory.json`.
  useEffect(() => {
    if (!rootPath || !workspaceService) {
      setFactsService(null);
      return;
    }
    const storage = buildFactsStorage(workspaceService, rootPath);
    setFactsService(createFactsService({ storage }));
    return () => {
      setFactsService(null);
    };
  }, [rootPath, workspaceService]);

  // Per-workspace lifecycle.
  useEffect(() => {
    if (!rootPath) return;

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;

        await MemoryService.setWorkspace(rootPath);
        await mailSetWorkspace(rootPath);
        await watchWorkspace(rootPath);

        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<WorkspaceChangeEvent>(
          'workspace-file-changed',
          (event) => {
            const payload = event.payload;
            if (!payload?.path) return;
            // Best-effort: don't await, don't surface errors.
            const isPdf = payload.path.toLowerCase().endsWith('.pdf');
            if (payload.kind === 'delete') {
              void MemoryService.deletePath(payload.path);
            } else if (isPdf && workspaceService) {
              // Only re-index PDF on change if the toggle is on.
              if (isPdfIndexingEnabled() && workspaceService.readFileBinary) {
                const binaryWs = {
                  readBinary: (p: string) =>
                    workspaceService.readFileBinary!(p),
                };
                void MemoryService.indexPdfFile(payload.path, binaryWs).catch(() => {});
              }
            } else {
              void MemoryService.indexFile(payload.path);
            }
          },
        );
        if (cancelled) {
          stop();
        } else {
          unlisten = stop;
        }

        // Background full-workspace index. Resolves when complete; the
        // banner / badge UI follow progress events independently.
        void MemoryService.indexWorkspace().catch(() => {
          /* errors are surfaced via the progress event with status: error */
        });

        // A3: if PDF indexing is enabled, also index PDF files in the workspace.
        if (isPdfIndexingEnabled() && workspaceService) {
          void indexWorkspacePdfs(workspaceService).catch(() => {});
        }
      } catch {
        // Tauri or watcher init failed — leave memory disabled gracefully.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [rootPath]);

  // A3: React to toggle changes for includePdfsInWorkspaceIndex.
  // When turned ON, trigger PDF indexing. When turned OFF, remove PDF chunks.
  useEffect(() => {
    if (!rootPath || !workspaceService) return;

    let prevEnabled = Boolean(
      useSettingsStore.getState().getSetting<boolean>('includePdfsInWorkspaceIndex'),
    );

    const unsubscribe = useSettingsStore.subscribe((state) => {
      const enabled = Boolean(state.getSetting<boolean>('includePdfsInWorkspaceIndex'));
      if (enabled === prevEnabled) return;
      prevEnabled = enabled;
      if (enabled) {
        void indexWorkspacePdfs(workspaceService).catch(() => {});
      } else {
        // Remove PDF chunks. Collect .pdf paths from the current file tree.
        const { fileTree } = useWorkspaceStore.getState();
        const pdfPaths = collectPdfPaths(fileTree);
        void MemoryService.deleteAllPdfChunks(pdfPaths).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath, workspaceService]);

  // WS-B/C — re-index when a matter's folder mapping changes. Files in a
  // newly-mapped (or remapped/unmapped) folder need their chunks re-tagged
  // with the correct matter id so retrieval scoping stays accurate. We diff
  // the matters list on every change and re-index the files under any folder
  // whose matter assignment moved. Best-effort and debounced by Zustand's
  // single-notification-per-set semantics.
  useEffect(() => {
    if (!rootPath) return;
    let prevMatters = useMatterStore.getState().matters.map((m) => ({
      id: m.id,
      folderPaths: m.folderPaths,
    }));

    const unsubscribe = useMatterStore.subscribe((state) => {
      const nextMatters = state.matters.map((m) => ({
        id: m.id,
        folderPaths: m.folderPaths,
      }));
      const folders = changedFolderPaths(prevMatters, nextMatters);
      prevMatters = nextMatters;
      if (folders.length === 0) return;

      // For each changed folder, re-index its files under their (now current)
      // resolved matter id. resolveMatterIdForPath reflects the latest store.
      const { fileTree } = useWorkspaceStore.getState();
      const allPaths = collectAllFilePaths(fileTree);
      const affected = allPaths.filter((p) =>
        folders.some((folder) => isPathInFolder(p, folder)),
      );
      // Group by resolved matter id so we re-index in matter batches.
      const byMatter = new Map<string, string[]>();
      for (const p of affected) {
        const id = resolveMatterIdForPath(p);
        const list = byMatter.get(id) ?? [];
        list.push(p);
        byMatter.set(id, list);
      }
      for (const [matterId, paths] of byMatter) {
        void MemoryService.reindexPaths(paths, matterId).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath]);
}

export default useMemoryWiring;
