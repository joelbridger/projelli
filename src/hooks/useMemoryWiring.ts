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
  setOcrScannedPdfsEnabledReader,
  setMatterResolver,
  setPdfIndexingEnabledReader,
  setPrivilegeResolver,
} from '@/platform/rag/MemoryService';
import { getMatters, resolveMatterIdForPath, useMatterStore } from '@/stores/matterStore';
import {
  buildMailMatterMap,
  isPathInFolder,
  parseMailFolderKey,
} from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID } from '@/types/matter';
import { mailBackfillRag, mailRetagFolderMatter } from '@/utils/mail-commands';
import {
  resolvePrivilegeForSource,
  usePrivilegeStore,
} from '@/stores/privilegeStore';
import type { PrivilegeMap } from '@/platform/rag/privilegeResolver';
import { createFactsService, type FactsStorage } from '@/platform/rag/FactsService';
import {
  setFactsService,
  setFactsInjectionReader,
  setFactsAutoAcceptReader,
} from '@/platform/rag/factsSingleton';
import {
  MODEL_DOWNLOAD_EVENT,
  modelStatus,
  watchWorkspace,
  type ModelDownloadProgress,
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

/**
 * WS-B/C — diff two matters' mail-folder mappings and return the set of mail
 * folder keys whose matter assignment changed (added, removed, or moved between
 * matters), as `{ key, matterId }` (the resolved matter id after the change, or
 * the unassigned sentinel when the key was unmapped). When a mapping changes we
 * re-tag the already-synced mail in that folder so retrieval scoping updates
 * immediately. Mirrors `changedFolderPaths` but for mail folder keys.
 */
export function changedMailFolderPaths(
  prev: Array<{ id: string; mailFolderPaths?: string[] }>,
  next: Array<{ id: string; mailFolderPaths?: string[] }>,
): Array<{ key: string; matterId: string }> {
  const before = new Map<string, string>(); // key -> matterId
  for (const m of prev) for (const k of m.mailFolderPaths ?? []) before.set(k, m.id);
  const after = new Map<string, string>();
  for (const m of next) for (const k of m.mailFolderPaths ?? []) after.set(k, m.id);

  const changed = new Map<string, string>(); // key -> resolved matterId after change
  for (const [key, id] of after) {
    if (before.get(key) !== id) changed.set(key, id);
  }
  for (const [key] of before) {
    if (!after.has(key)) changed.set(key, UNASSIGNED_MATTER_ID); // unmapped -> unassigned
  }
  return Array.from(changed, ([key, matterId]) => ({ key, matterId }));
}

/**
 * WS-PRIV — diff two privilege maps and return the set of source ids whose
 * privilege changed (added, removed, or value-changed). When a source's
 * privilege changes we re-tag its already-indexed chunks so default retrieval
 * picks up the new exclusion immediately.
 */
export function changedPrivilegeSources(
  prev: PrivilegeMap,
  next: PrivilegeMap,
): string[] {
  const changed = new Set<string>();
  for (const key of Object.keys(next)) {
    if (prev[key] !== next[key]) changed.add(key);
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next)) changed.add(key); // privilege cleared back to "none"
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
    // VG-2 — local OCR for scanned PDF pages (default ON; getSetting falls
    // back to the schema default when unset).
    setOcrScannedPdfsEnabledReader(() =>
      Boolean(useSettingsStore.getState().getSetting<boolean>('ocrScannedPdfs')),
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
    // WS-PRIV — install the privilege resolver so every indexed chunk is tagged
    // with its source's privilege (or "none"), keeping privileged content
    // excluded from default retrieval even after a re-index.
    setPrivilegeResolver((sourceId) => resolvePrivilegeForSource(sourceId));
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
    const stopModelListeners: Array<() => void> = [];
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
        //
        // Option B: the index needs the embedding model. When it is still
        // downloading (first run), wait for the model-download ready event
        // and start then — the Rust side also refuses without consuming
        // the once-per-activation latch, so this re-call gets a full walk.
        const startFullIndex = () => {
          void MemoryService.indexWorkspace().catch(() => {
            /* errors are surfaced via the progress event with status: error */
          });
          // A3: if PDF indexing is enabled, also index PDF files in the workspace.
          if (isPdfIndexingEnabled() && workspaceService) {
            void indexWorkspacePdfs(workspaceService).catch(() => {});
          }
          // Option B healing: re-index any mail imported while the model was
          // still downloading, from the local encrypted bodies. The Rust side
          // no-ops fast when the backfill marker is absent (the common case),
          // so this is safe to fire on every activation. The matter map scopes
          // each backfilled message exactly as a sync would have.
          void mailBackfillRag(buildMailMatterMap(getMatters())).catch(() => {});
        };
        // Listen-first-then-check: register the ready listener BEFORE probing
        // modelStatus(), so a ready event landing between the probe and the
        // listen can't be missed (the session would otherwise never index
        // until the next launch). If both the event and the probe report
        // ready, the flag makes the kick-off run exactly once.
        let fullIndexStarted = false;
        const startFullIndexOnce = () => {
          if (fullIndexStarted) return;
          fullIndexStarted = true;
          startFullIndex();
        };
        const stopModelListen = await listen<ModelDownloadProgress>(
          MODEL_DOWNLOAD_EVENT,
          (event) => {
            if (event.payload.state === 'ready') {
              stopModelListen();
              startFullIndexOnce();
            }
          },
        );
        if (cancelled) stopModelListen();
        else stopModelListeners.push(stopModelListen);

        const status = await modelStatus().catch(() => 'ready');
        if (status === 'ready') {
          // Already ready — the listener is unnecessary; drop it and start
          // immediately. Otherwise keep the listener; it starts the index on
          // the ready event.
          stopModelListen();
          startFullIndexOnce();
        }
      } catch {
        // Tauri or watcher init failed — leave memory disabled gracefully.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      stopModelListeners.forEach((s) => {
        s();
      });
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

  // WS-B/C — re-tag synced mail when a matter's mail-folder mapping changes.
  // Mapping a mail folder to a matter (or remapping/unmapping it) must re-scope
  // the email already imported from that folder so retrieval reflects the new
  // matter immediately, without a full re-sync. We diff the matters' mail-folder
  // mappings on every change and re-tag each affected folder's messages IN PLACE
  // via `mail_retag_folder_matter` (the same re-tag path files use). Best-effort
  // and debounced by Zustand's single-notification-per-set semantics.
  useEffect(() => {
    if (!rootPath) return;
    let prevMatters = useMatterStore.getState().matters.map((m) => ({
      id: m.id,
      mailFolderPaths: m.mailFolderPaths ?? [],
    }));

    const unsubscribe = useMatterStore.subscribe((state) => {
      const nextMatters = state.matters.map((m) => ({
        id: m.id,
        mailFolderPaths: m.mailFolderPaths ?? [],
      }));
      const changed = changedMailFolderPaths(prevMatters, nextMatters);
      prevMatters = nextMatters;
      if (changed.length === 0) return;
      for (const { key, matterId } of changed) {
        const parsed = parseMailFolderKey(key);
        if (!parsed) continue;
        void mailRetagFolderMatter(
          parsed.provider,
          parsed.account,
          parsed.folderId,
          matterId,
        ).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath]);

  // WS-PRIV — re-tag when a source's privilege changes. Marking a source
  // privileged must immediately remove it from default retrieval (and clearing
  // privilege must restore it), so we diff the privilege map on every change and
  // re-tag the affected sources' already-indexed chunks IN PLACE (no re-embed)
  // via `rag_retag_privilege`. Best-effort and debounced by Zustand's
  // single-notification-per-set semantics. Mirrors the matter re-index reaction.
  useEffect(() => {
    if (!rootPath) return;
    let prevMap = { ...usePrivilegeStore.getState().privilegeBySource };

    const unsubscribe = usePrivilegeStore.subscribe((state) => {
      const nextMap = { ...state.privilegeBySource };
      const sources = changedPrivilegeSources(prevMap, nextMap);
      prevMap = nextMap;
      if (sources.length === 0) return;
      for (const sourceId of sources) {
        // resolvePrivilegeForSource reflects the latest store (a cleared entry
        // resolves to "none", which re-tags the chunks back to non-privileged).
        const privilege = resolvePrivilegeForSource(sourceId);
        void MemoryService.retagPrivilege(sourceId, privilege).catch(() => {});
      }
    });
    return unsubscribe;
  }, [rootPath]);
}

export default useMemoryWiring;
