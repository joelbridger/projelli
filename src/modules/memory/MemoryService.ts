/**
 * MemoryService — opt-out wrapper around the Tauri RAG commands.
 *
 * The Settings panel has a `memory.enabled` toggle (defaults to `true`). When
 * disabled, every entry point here short-circuits without invoking the
 * embedder or LanceDB:
 *
 *   - `indexFile` / `indexWorkspace`: resolve immediately
 *   - `retrieve`: returns `[]`
 *
 * That means ALL future memory features (M1 retrieval, M2 @workspace,
 * M3 facts) can be disabled with a single toggle without each call site
 * having to know about the setting. Importantly the toggle controls the
 * RUNTIME behaviour only — there is no persistent disabling that orphans
 * data in `<workspace>/.projelli/vectors/`. Re-enabling the toggle
 * re-uses whatever has already been indexed.
 */

import {
  ragCancelIndexing,
  ragDeletePath,
  ragIndexFile,
  ragIndexWorkspace,
  ragRetrieve,
  ragSetWorkspace,
  type RagHit,
} from '@/utils/tauri-commands';

/** How the toggle is read. Pluggable so tests can pass a stub. */
export type MemoryEnabledReader = () => boolean;

const DEFAULT_ENABLED_READER: MemoryEnabledReader = () => true;

let isEnabledReader: MemoryEnabledReader = DEFAULT_ENABLED_READER;

/** Install a reader function. Called once from `App.tsx` on mount, with a
 *  closure over `useSettingsStore.getState().getSetting`. Tests can swap
 *  this for a stub. */
export function setMemoryEnabledReader(reader: MemoryEnabledReader): void {
  isEnabledReader = reader;
}

/** Reset to the always-on default. Test helper. */
export function resetMemoryEnabledReader(): void {
  isEnabledReader = DEFAULT_ENABLED_READER;
}

/** Current value of the toggle. Exposed for the status badge so it can
 *  render "Memory: paused" instead of the indexing progress when off. */
export function isMemoryEnabled(): boolean {
  try {
    return isEnabledReader();
  } catch {
    // If the reader throws (settings not hydrated yet, etc.) default to ON
    // so the user doesn't think memory is broken.
    return true;
  }
}

export const MemoryService = {
  /** Point the indexer at a workspace. Always runs even if disabled — the
   *  workspace handle is metadata, not user data. */
  async setWorkspace(path: string): Promise<void> {
    await ragSetWorkspace(path);
  },

  async indexFile(path: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    await ragIndexFile(path);
  },

  async indexWorkspace(): Promise<void> {
    if (!isMemoryEnabled()) return;
    await ragIndexWorkspace();
  },

  async cancelIndexing(): Promise<void> {
    await ragCancelIndexing();
  },

  async deletePath(path: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    await ragDeletePath(path);
  },

  async retrieve(query: string, topK: number): Promise<RagHit[]> {
    if (!isMemoryEnabled()) return [];
    if (!query.trim() || topK <= 0) return [];
    return ragRetrieve(query, topK);
  },
};

export type { RagHit };
