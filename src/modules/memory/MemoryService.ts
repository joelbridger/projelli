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
 * data in `<workspace>/.keepance/vectors/`. Re-enabling the toggle
 * re-uses whatever has already been indexed.
 */

import {
  ragCancelIndexing,
  ragDeletePath,
  ragIndexFile,
  ragIndexPdfChunks,
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

// A3 — PDF indexing toggle reader (mirrors the memory-enabled pattern).

/** Reader type for the PDF indexing toggle. Pluggable for tests. */
export type PdfIndexingEnabledReader = () => boolean;

/** Default is OFF — PDF indexing is opt-in. */
const DEFAULT_PDF_ENABLED_READER: PdfIndexingEnabledReader = () => false;

let isPdfEnabledReader: PdfIndexingEnabledReader = DEFAULT_PDF_ENABLED_READER;

/** Install a reader for `includePdfsInWorkspaceIndex`. Called from
 *  `useMemoryWiring` alongside `setMemoryEnabledReader`. */
export function setPdfIndexingEnabledReader(reader: PdfIndexingEnabledReader): void {
  isPdfEnabledReader = reader;
}

/** Reset to the always-off default. Test helper. */
export function resetPdfIndexingEnabledReader(): void {
  isPdfEnabledReader = DEFAULT_PDF_ENABLED_READER;
}

/** Current value of the PDF indexing toggle. */
export function isPdfIndexingEnabled(): boolean {
  try {
    return isPdfEnabledReader();
  } catch {
    return false;
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

  /** Index a single PDF file into the RAG store. Reads bytes via the
   *  provided workspace service, extracts text with PDF.js (via dynamic
   *  import of src/lib/pdf-extract.ts from A2), then calls the Rust-side
   *  rag_index_pdf_chunks command. No-op if memory or PDF indexing is disabled. */
  async indexPdfFile(
    path: string,
    workspaceService: { readBinary: (path: string) => Promise<ArrayBuffer> },
  ): Promise<{ indexed: boolean; pageCount: number; reason?: string }> {
    if (!isMemoryEnabled()) {
      return { indexed: false, pageCount: 0, reason: 'memory-disabled' };
    }
    if (!isPdfIndexingEnabled()) {
      return { indexed: false, pageCount: 0, reason: 'pdf-indexing-disabled' };
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await workspaceService.readBinary(path);
    } catch {
      return { indexed: false, pageCount: 0, reason: 'read-error' };
    }

    // extractPdfText is from src/lib/pdf-extract.ts (shipped in A2).
    const { extractPdfText } = await import('@/lib/pdf-extract');
    const result = await extractPdfText(new Uint8Array(bytes));

    if (result.encrypted) {
      return { indexed: false, pageCount: result.pageCount, reason: 'encrypted' };
    }
    if (result.scanned) {
      return { indexed: false, pageCount: result.pageCount, reason: 'scanned' };
    }

    const chunksStored = await ragIndexPdfChunks(path, result.pages, result.pageCount);
    return {
      indexed: chunksStored > 0,
      pageCount: result.pageCount,
    };
  },

  /** Remove all stored chunks for the given PDF file paths. Called when
   *  the user turns OFF the `includePdfsInWorkspaceIndex` toggle. Best-effort
   *  — errors are silently swallowed since this is housekeeping. */
  async deleteAllPdfChunks(filePaths: string[]): Promise<void> {
    if (!isMemoryEnabled()) return;
    for (const path of filePaths) {
      try {
        await ragDeletePath(path);
      } catch {
        // Best-effort: swallow and keep going.
      }
    }
  },
};

export type { RagHit };
