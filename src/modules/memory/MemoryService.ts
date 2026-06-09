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
  ragRetagPrivilege,
  ragRetrieve,
  ragSetWorkspace,
  type RagHit,
  type RetrievalScope,
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

// WS-B/C — matter resolver. The indexer must tag every chunk with the matter
// the file belongs to, so retrieval can prefilter by matter. Pluggable so
// MemoryService stays free of the matter store (and tests can stub it).

/** Resolve a file path -> matter id. */
export type MatterResolver = (path: string) => string;

/** Default: everything is unassigned until a real resolver is installed. */
const DEFAULT_MATTER_RESOLVER: MatterResolver = () => 'unassigned';

let matterResolver: MatterResolver = DEFAULT_MATTER_RESOLVER;

/** Install the matter resolver. Called from `useMemoryWiring` with a closure
 *  over `resolveMatterIdForPath` from the matter store. */
export function setMatterResolver(resolver: MatterResolver): void {
  matterResolver = resolver;
}

/** Reset to the always-unassigned default. Test helper. */
export function resetMatterResolver(): void {
  matterResolver = DEFAULT_MATTER_RESOLVER;
}

/** Resolve a path to its matter id via the installed resolver. Never throws —
 *  falls back to the unassigned sentinel if the resolver misbehaves. */
export function resolveMatterForPath(path: string): string {
  try {
    return matterResolver(path) || 'unassigned';
  } catch {
    return 'unassigned';
  }
}

// WS-PRIV — privilege resolver. The indexer must tag every chunk with the
// privilege of the source it belongs to, so privileged content is excluded from
// retrieval by default. Pluggable so MemoryService stays free of the privilege
// store (and tests can stub it), mirroring the matter resolver.

/** Resolve a source id (path / `mail:<id>` / `.aichat` path) → privilege value. */
export type PrivilegeResolver = (sourceId: string) => string;

/** Default: everything is "none" (not privileged) until a real resolver is installed. */
const DEFAULT_PRIVILEGE_RESOLVER: PrivilegeResolver = () => 'none';

let privilegeResolver: PrivilegeResolver = DEFAULT_PRIVILEGE_RESOLVER;

/** Install the privilege resolver. Called from `usePrivilegeWiring` with a
 *  closure over `resolvePrivilegeForSource` from the privilege store. */
export function setPrivilegeResolver(resolver: PrivilegeResolver): void {
  privilegeResolver = resolver;
}

/** Reset to the always-"none" default. Test helper. */
export function resetPrivilegeResolver(): void {
  privilegeResolver = DEFAULT_PRIVILEGE_RESOLVER;
}

/** Resolve a source id to its privilege via the installed resolver. Never
 *  throws — falls back to "none" (the SAFE default is non-privileged content;
 *  a resolver failure must never accidentally mark content privileged AND must
 *  never accidentally surface it — "none" keeps indexing correct and the user
 *  re-tags explicitly). */
export function resolvePrivilegeForPath(sourceId: string): string {
  try {
    return privilegeResolver(sourceId) || 'none';
  } catch {
    return 'none';
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
    // WS-B/C: tag the chunk with the matter this file belongs to so retrieval
    // can prefilter by matter. Resolves to "unassigned" when the file is not
    // under any matter's mapped folders.
    // WS-PRIV: also tag with the source's privilege so privileged content is
    // excluded from default retrieval. Resolves to "none" when not tagged.
    await ragIndexFile(path, resolveMatterForPath(path), resolvePrivilegeForPath(path));
  },

  /**
   * Index the entire active workspace. The Rust walker files every chunk under
   * the single `matterId` passed here; since one workspace can span many
   * matters, the default full walk uses the `unassigned` sentinel, and the
   * per-file watcher (which calls `indexFile`) re-tags each file with its real
   * matter as it is touched. To re-index ONE matter's folders under its id,
   * pass `matterId` explicitly (see `reindexMatterFolders`).
   */
  async indexWorkspace(matterId?: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    await ragIndexWorkspace(matterId);
  },

  /**
   * WS-B/C — re-index a single matter's mapped folders under that matter id.
   * Called when a matter's folder mapping changes so the files in the newly
   * mapped (or remapped) folders are tagged with the correct matter. Walks the
   * supplied file paths and re-indexes each via `rag_index_file` with the
   * matter id. Best-effort: individual failures are swallowed so one bad file
   * doesn't abort the batch.
   */
  async reindexPaths(paths: string[], matterId: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    for (const path of paths) {
      try {
        // WS-PRIV: preserve each file's privilege across a matter re-index so a
        // matter remap never silently un-privileges a source.
        await ragIndexFile(path, matterId, resolvePrivilegeForPath(path));
      } catch {
        // Best-effort: skip and continue.
      }
    }
  },

  /**
   * WS-PRIV — set a source's privilege and re-tag its already-indexed chunks in
   * place (no re-embed). Called when the user marks a file / email / chat as
   * privileged (or clears it). Returns the number of chunks updated. No-op when
   * memory is disabled (nothing is indexed to re-tag). Best-effort at the call
   * site; this surfaces the count so callers can decide whether to also index.
   */
  async retagPrivilege(sourceId: string, privilege: string): Promise<number> {
    if (!isMemoryEnabled()) return 0;
    return ragRetagPrivilege(sourceId, privilege);
  },

  async cancelIndexing(): Promise<void> {
    await ragCancelIndexing();
  },

  async deletePath(path: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    await ragDeletePath(path);
  },

  /** Retrieve from the local RAG store.
   *
   *  WS-B/C: `scope` is the confidentiality boundary. It defaults to an explicit
   *  cross-matter (`allMatters`) search to preserve the pre-3.0 whole-workspace
   *  behaviour until the matter-assignment UI lands and passes a real
   *  `{ kind: 'matter', matterId }` scope here. There is no silent "everything"
   *  path: the underlying command requires a named scope.
   *
   *  WS-PRIV: `includePrivileged` defaults to `false` — attorney-client and
   *  work-product content is EXCLUDED by default. Pass `true` only for a
   *  deliberate, user-initiated query that opts privileged sources in. */
  async retrieve(
    query: string,
    topK: number,
    scope: RetrievalScope = { kind: 'allMatters' },
    includePrivileged = false,
  ): Promise<RagHit[]> {
    if (!isMemoryEnabled()) return [];
    if (!query.trim() || topK <= 0) return [];
    return ragRetrieve(query, topK, scope, includePrivileged);
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

    // WS-B/C: tag PDF chunks with the matter this file belongs to.
    // WS-PRIV: tag with the source's privilege so a privileged PDF is excluded
    // from default retrieval.
    const chunksStored = await ragIndexPdfChunks(
      path,
      result.pages,
      result.pageCount,
      resolveMatterForPath(path),
      resolvePrivilegeForPath(path),
    );
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
