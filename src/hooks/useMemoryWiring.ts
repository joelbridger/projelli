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
  MemoryService,
  setMemoryEnabledReader,
} from '@/modules/memory/MemoryService';
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

/** Build a FactsStorage adapter from a WorkspaceService-shaped object.
 *  Accepts `any` so this stays decoupled from the concrete service
 *  type — App.tsx passes its workspaceServiceRef.current through. */
export function buildFactsStorage(
  workspaceService: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    delete?: (path: string) => Promise<void>;
  },
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

export function useMemoryWiring(
  rootPath: string | null,
  workspaceService?: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
    delete?: (path: string) => Promise<void>;
  } | null,
): void {
  // Wire the toggle reader once. Safe to call repeatedly — last writer wins.
  useEffect(() => {
    setMemoryEnabledReader(() =>
      Boolean(useSettingsStore.getState().getSetting<boolean>('memoryEnabled')),
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
        await watchWorkspace(rootPath);

        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<WorkspaceChangeEvent>(
          'workspace-file-changed',
          (event) => {
            const payload = event.payload;
            if (!payload?.path) return;
            // Best-effort: don't await, don't surface errors. The watcher
            // fires more often than is useful (every keystroke if the
            // user's editor saves on each), so failures are absorbed.
            if (payload.kind === 'delete') {
              void MemoryService.deletePath(payload.path);
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
      } catch {
        // Tauri or watcher init failed — leave memory disabled gracefully.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [rootPath]);
}

export default useMemoryWiring;
