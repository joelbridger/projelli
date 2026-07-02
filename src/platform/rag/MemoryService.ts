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
  ragManifestForgetPdfs,
  ragManifestRecordPdf,
  ragReconcileWorkspace,
  ragRetagMatter,
  ragRetagMatterBatch,
  ragRetagPrivilege,
  ragRetrieve,
  ragSetWorkspace,
  OCR_SKIP_CONFIDENCE,
  type RagHit,
  type RetrievalScope,
} from '@/platform/utils/tauri-commands';

/**
 * Pluggable retrieval backend. Defaults to the Tauri `rag_retrieve` command
 * (the desktop app's native LanceDB + embeddings). The browser web-demo has no
 * Tauri backend — `ragRetrieve` throws "RAG is only available in the desktop
 * app." there — so the demo bootstrap installs a browser-side keyword retriever
 * (`src/web-demo/demoRetrieval.ts`) via `setRetrievalBackend`. This is the same
 * dependency-injection seam already used for the matter/privilege resolvers and
 * the enabled reader, so MemoryService never imports web-demo code (it stays a
 * leaf of the platform layer) and desktop behaviour is byte-for-byte unchanged.
 */
export type RetrievalBackend = (
  query: string,
  topK: number,
  scope: RetrievalScope,
  includePrivileged: boolean,
  perSourceCap: number | undefined,
  enableReranker: boolean,
  enableHybridSearch: boolean,
) => Promise<RagHit[]>;

const DEFAULT_RETRIEVAL_BACKEND: RetrievalBackend = (
  query,
  topK,
  scope,
  includePrivileged,
  perSourceCap,
  enableReranker,
  enableHybridSearch,
) =>
  ragRetrieve(query, topK, scope, includePrivileged, perSourceCap, enableReranker, enableHybridSearch);

let retrievalBackend: RetrievalBackend = DEFAULT_RETRIEVAL_BACKEND;

/** Install a retrieval backend. Called once from the web-demo bootstrap with a
 *  browser keyword retriever; the desktop app never calls it, so it keeps the
 *  native Tauri command. */
export function setRetrievalBackend(backend: RetrievalBackend): void {
  retrievalBackend = backend;
}

/** Reset to the native Tauri retrieve. Test helper. */
export function resetRetrievalBackend(): void {
  retrievalBackend = DEFAULT_RETRIEVAL_BACKEND;
}

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

// VG-2 — OCR toggle reader (`ocrScannedPdfs`, default ON). Mirrors the PDF
// indexing toggle pattern. When ON and the engine is available, scanned pages
// are read by the local OCR engine instead of being skipped.

/** Reader type for the OCR toggle. Pluggable for tests. */
export type OcrScannedPdfsEnabledReader = () => boolean;

/** Default is ON — scanned pages should be searchable out of the box. */
const DEFAULT_OCR_ENABLED_READER: OcrScannedPdfsEnabledReader = () => true;

let isOcrEnabledReader: OcrScannedPdfsEnabledReader = DEFAULT_OCR_ENABLED_READER;

/** Install a reader for `ocrScannedPdfs`. Called from `useMemoryWiring`
 *  alongside the other toggle readers. */
export function setOcrScannedPdfsEnabledReader(reader: OcrScannedPdfsEnabledReader): void {
  isOcrEnabledReader = reader;
}

/** Reset to the always-on default. Test helper. */
export function resetOcrScannedPdfsEnabledReader(): void {
  isOcrEnabledReader = DEFAULT_OCR_ENABLED_READER;
}

/** Current value of the OCR toggle (defaults ON, like the schema default). */
export function isOcrScannedPdfsEnabled(): boolean {
  try {
    return isOcrEnabledReader();
  } catch {
    return true;
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

/**
 * F-301 guard: true while a default (whole-workspace) index is in flight, so
 * overlapping `indexWorkspace()` calls coalesce instead of stacking up. Reset in
 * a `finally`, so a rejected index can never wedge it permanently on.
 */
let workspaceIndexInFlight = false;

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
   *
   * F-301 defense-in-depth: coalesce overlapping full-workspace indexes at the
   * call site so we don't even issue a redundant `invoke` while one is already
   * running. A full index is fired on every workspace open; rapid re-opens
   * (e.g. under a dev HMR reload-storm) would otherwise pile up overlapping
   * walks whose Rust-side connections + embedding buffers ran memory away to an
   * OOM. The Rust command also coalesces (the authoritative guard); this just
   * avoids the wasted IPC. Per-matter re-index (`matterId` set) is NOT gated by
   * this flag — it is a distinct, scoped operation.
   */
  async indexWorkspace(matterId?: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    if (matterId === undefined) {
      if (workspaceIndexInFlight) return;
      workspaceIndexInFlight = true;
      try {
        // P1.1 — the default boot index is now a cheap RECONCILE: it skips files
        // whose signature is unchanged in the manifest and only re-embeds new /
        // changed ones (falling back to a full rebuild on a schema migration).
        // This is what makes a warm boot near-instant instead of a full re-embed.
        await ragReconcileWorkspace(matterId);
      } finally {
        workspaceIndexInFlight = false;
      }
      return;
    }
    // A SCOPED re-index (a specific matter's folders) stays a full walk under that
    // matter id — it is a deliberate re-tag operation, not a boot.
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

  /**
   * WS-B/C — set a source's matter and re-tag its already-indexed chunks in
   * place (no re-embed). Used to re-scope a single source (e.g. a `mail:<id>`)
   * when its matter changes. Returns the number of chunks updated. No-op when
   * memory is disabled. This is the matter-scope mirror of `retagPrivilege`.
   */
  async retagMatter(sourceId: string, matterId: string): Promise<number> {
    if (!isMemoryEnabled()) return 0;
    return ragRetagMatter(sourceId, matterId);
  },

  /**
   * P1.1 — BATCHED matter retag: re-tag many sources' chunks to `matterId` in one
   * LanceDB UPDATE per chunk. The boot retag of a mapped client folder uses this
   * (grouped per matter) so a warm boot of a mapped workspace stays cheap.
   */
  async retagMatterBatch(sourceIds: string[], matterId: string): Promise<number> {
    if (!isMemoryEnabled() || sourceIds.length === 0) return 0;
    return ragRetagMatterBatch(sourceIds, matterId);
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
   *  WS-B/C: `scope` is the confidentiality boundary and is REQUIRED (F2.6b — no
   *  default). Every caller must state its scope: pass `{ kind: 'matter', matterId }`
   *  for a per-client search, or `{ kind: 'allMatters' }` for a deliberate
   *  cross-client one. There is no silent "everything" path — neither this method
   *  nor the underlying command has a default, so a new caller can't leak across
   *  clients by simply omitting the scope.
   *
   *  WS-PRIV: `includePrivileged` defaults to `false` — attorney-client and
   *  work-product content is EXCLUDED by default. Pass `true` only for a
   *  deliberate, user-initiated query that opts privileged sources in.
   *
   *  F-510: `perSourceCap` optionally caps how many hits one source document
   *  may contribute (rank-preserving; the backend overfetches then caps).
   *  Omitted = no cap — chat retrieval and every existing caller unchanged.
   *
   *  WS3d-A: `enableReranker` (default false) turns on the optional
   *  cross-encoder reranking pass. Off = byte-for-byte the vector-only path;
   *  callers read the `enableReranker` setting and pass it here per call.
   *
   *  `enableHybridSearch` (default false) turns on the optional keyword + vector
   *  blended search pass. Off = pure vector-only path; callers read the
   *  `enableHybridSearch` setting and pass it here per call. */
  async retrieve(
    query: string,
    topK: number,
    // F2.6b: `scope` is REQUIRED — no `allMatters` default. A silent default let a
    // future caller search every client's memory by simply omitting it; now the
    // compiler forces each caller to state its scope, and any deliberate
    // cross-client search must pass `{ kind: 'allMatters' }` explicitly.
    scope: RetrievalScope,
    includePrivileged = false,
    perSourceCap?: number,
    enableReranker = false,
    enableHybridSearch = false,
  ): Promise<RagHit[]> {
    if (!isMemoryEnabled()) return [];
    if (!query.trim() || topK <= 0) return [];
    return retrievalBackend(
      query,
      topK,
      scope,
      includePrivileged,
      perSourceCap,
      enableReranker,
      enableHybridSearch,
    );
  },

  /** Index a single PDF file into the RAG store. Reads bytes via the
   *  provided workspace service, extracts text with PDF.js (via dynamic
   *  import of src/lib/pdf-extract.ts from A2), then calls the Rust-side
   *  rag_index_pdf_chunks command. No-op if memory or PDF indexing is disabled.
   *
   *  VG-2: pages whose text layer is empty (per-page `pageNeedsOcr`) are read
   *  by the LOCAL OCR engine when the `ocrScannedPdfs` toggle is on and the
   *  engine is available, so scanned filings become searchable. Per-page mean
   *  word confidence rides along to the store (`pageConfidences`) so citations
   *  can disclose OCR provenance and low confidence. Toggle off or engine
   *  unavailable keeps the previous honest behaviour: a fully scanned file is
   *  skipped with `reason: 'scanned'`; a mixed file indexes its native pages.
   *
   *  WS3c: OCR pages whose confidence is below `OCR_SKIP_CONFIDENCE` (30) are
   *  near-gibberish and are dropped here so they never enter the index. A file
   *  whose ONLY content was such sub-threshold OCR pages is reported as a
   *  scanned-equivalent skip (`reason: 'scanned-low-confidence'`), never a
   *  silent empty index. If OCR ran but every page instead FAILED to
   *  render/recognize (no low-confidence drop at all) the file reports
   *  `reason: 'ocr-failed'` so a real engine fault isn't hidden behind the
   *  low-confidence label. Native pages and OCR pages at >= 30 are unaffected. */
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
    const pdfExtract = await import('@/lib/pdf-extract');
    const data = new Uint8Array(bytes);
    // PDF.js transfers the buffer it is given to its worker (detaching it
    // here), so extraction gets a COPY — `data` stays intact for the OCR
    // page renders below.
    const result = await pdfExtract.extractPdfText(data.slice());

    if (result.encrypted) {
      return { indexed: false, pageCount: result.pageCount, reason: 'encrypted' };
    }

    // VG-2 — the OCR pipeline. Per-page scanned-ness (not the whole-file
    // flag) so a mixed native/scanned filing OCRs only its scanned pages.
    let pages = result.pages;
    let pageConfidences: (number | undefined)[] | undefined;
    const ocrPageIndices = result.pages
      .map((pageText, index) => (pdfExtract.pageNeedsOcr(pageText) ? index : -1))
      .filter((index) => index >= 0);
    if (ocrPageIndices.length > 0) {
      const ocr = await import('@/platform/rag/ocr/ocrEngine');
      if (isOcrScannedPdfsEnabled() && ocr.isOcrEngineAvailable()) {
        const { useOcrProgressStore } = await import('@/platform/rag/ocrProgressStore');
        pages = [...result.pages];
        pageConfidences = new Array<number | undefined>(result.pages.length).fill(undefined);
        try {
          // F-501: page render + OCR is memory-heavy (~150-200 MB worker heap
          // plus the rendered bitmap). Process pages strictly SEQUENTIALLY —
          // never render or recognize all pages at once.
          let done = 0;
          for (const pageIndex of ocrPageIndices) {
            done += 1;
            useOcrProgressStore.getState().set({
              path,
              page: done,
              totalPages: ocrPageIndices.length,
            });
            try {
              const png = await pdfExtract.renderPdfPageToPng(data, pageIndex);
              const { text, confidence } = await ocr.ocrPageImage(png);
              pages[pageIndex] = text;
              pageConfidences[pageIndex] = confidence;
            } catch (err) {
              // Per-page failure: log, leave THIS page empty, keep going —
              // the native pages (and other OCR pages) must never be lost.
              console.warn(`[memory] OCR failed for ${path} page ${String(pageIndex + 1)}:`, err);
            }
          }
        } finally {
          useOcrProgressStore.getState().clear();
          // Return the OCR worker's wasm heap (~150-200 MB) now that this
          // file's scanned pages are done; the next file re-initializes.
          await ocr.destroyOcrClient().catch(() => undefined);
        }
      } else if (result.scanned) {
        // Toggle off or engine unavailable AND the file has no native text
        // worth indexing: the previous honest skip.
        return { indexed: false, pageCount: result.pageCount, reason: 'scanned' };
      }
      // Mixed file with OCR unavailable: fall through and index the native
      // pages exactly as before VG-2.
    }

    // WS3c — OCR confidence skip gate. An OCR-read page whose mean word
    // confidence is below OCR_SKIP_CONFIDENCE (30) is near-gibberish; indexing
    // it would pollute retrieval and produce bad citations. Drop those pages
    // here (the sole PDF ingest path) BEFORE the store call: blanking a page's
    // text makes the Rust chunker skip it (its empty-page skip), and clearing
    // that page's confidence keeps `pageConfidences` aligned with `pages`.
    //
    // Only OCR-read pages (a numeric confidence) are eligible — native-text
    // pages (confidence `undefined`) are always indexed, and OCR pages at >= 30
    // keep their text AND their confidence so the 30–60 "low-confidence scan"
    // disclosure label is unaffected. `pageConfidences` is only defined when
    // OCR actually ran, so the native-only path is untouched.
    if (pageConfidences) {
      let droppedLowConfidence = false;
      for (let i = 0; i < pageConfidences.length; i += 1) {
        const conf = pageConfidences[i];
        if (conf !== undefined && conf < OCR_SKIP_CONFIDENCE) {
          pages[i] = '';
          pageConfidences[i] = undefined;
          droppedLowConfidence = true;
        }
      }
      // Fully-unreadable scan: OCR ran but nothing survived to index and there
      // is no native text to fall back on. Don't silently return an empty
      // "indexed: false" with no reason — report it honestly so the caller can
      // surface it, and clear any stale rows so a file that previously indexed
      // cleanly doesn't leave orphans behind. Two honest causes, kept distinct
      // so the reason isn't misleading for debugging:
      //   - at least one page was dropped by the < 30 gate  → 'scanned-low-confidence'
      //   - no page was low-confidence, every OCR page just failed to
      //     render/recognize (all confidences stayed undefined) → 'ocr-failed'
      if (pages.every((p) => p.trim().length === 0)) {
        await ragDeletePath(path).catch(() => undefined);
        return {
          indexed: false,
          pageCount: result.pageCount,
          reason: droppedLowConfidence ? 'scanned-low-confidence' : 'ocr-failed',
        };
      }
    }

    // WS-B/C: tag PDF chunks with the matter this file belongs to.
    // WS-PRIV: tag with the source's privilege so a privileged PDF is excluded
    // from default retrieval.
    // VG-2: ONE command call for the whole file — the embed stays batched on
    // the Rust side; pageConfidences aligns with pages.
    const matterId = resolveMatterForPath(path);
    const privilege = resolvePrivilegeForPath(path);
    const chunksStored = await ragIndexPdfChunks(
      path,
      pages,
      result.pageCount,
      matterId,
      privilege,
      pageConfidences,
    );
    if (chunksStored > 0) {
      // P1.1 (Task 3): record the PDF's signature (size/mtime + OCR setting +
      // page count) so a later boot can SKIP this PDF while unchanged instead of
      // re-extracting + re-OCR-ing it. Best-effort; never blocks indexing.
      await ragManifestRecordPdf(
        path,
        result.pageCount,
        isOcrScannedPdfsEnabled(),
        matterId,
        privilege,
      );
    }
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
    // P1.1 (Task 3): the PDF rows are gone, so drop their manifest signatures too.
    // Otherwise a later toggle-ON would see them "fresh" and skip re-indexing,
    // silently dropping those PDFs from search until each file changes.
    await ragManifestForgetPdfs();
  },
};

export type { RagHit };
