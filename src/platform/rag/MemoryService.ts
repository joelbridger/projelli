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
 * data in `<workspace>/.lantern/vectors/`. Re-enabling the toggle
 * re-uses whatever has already been indexed.
 */

import {
  ragCancelIndexing,
  ragDeletePdfPath,
  ragDeletePath,
  ragIndexFile,
  ragIndexPdfChunks,
  ragIndexWorkspace,
  ragManifestForgetPdf,
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

// QA-44 — a privileged source can be stored under one path FORM (the privilege
// UI marks a file by its workspace-RELATIVE `node.path`) while a RAG hit for the
// same file carries the ABSOLUTE path. Privilege resolution is an exact-key map
// lookup (unlike matter resolution, which already tries every path form), so a
// stale-index hit could slip past the privilege re-check on a form mismatch.
// This pluggable provider yields every equivalent form of a source id (as-is,
// workspace-relative, workspace-absolute) so the re-check fails closed if ANY
// form is privileged. Default = identity (the desktop app installs the real,
// rootPath-aware one from `useMemoryWiring`). Kept as a seam so MemoryService
// stays a platform leaf, mirroring the resolver seams above.
export type SourceIdForms = (sourceId: string) => string[];

const DEFAULT_SOURCE_ID_FORMS: SourceIdForms = (id) => [id];

let sourceIdForms: SourceIdForms = DEFAULT_SOURCE_ID_FORMS;

/** Install the source-id form expander. Called from `useMemoryWiring`. */
export function setSourceIdForms(forms: SourceIdForms): void {
  sourceIdForms = forms;
}

/** Reset to the identity default. Test helper. */
export function resetSourceIdForms(): void {
  sourceIdForms = DEFAULT_SOURCE_ID_FORMS;
}

// QA-44 — retrieval fail-closed for wrong-client (matter) exposure. While a
// folder's matter re-tag is pending or failed, its files' chunks may still carry
// a stale (wrong-client) tag; a swallowed re-tag failure used to leave them
// retrievable under the old scope. This pluggable predicate lets the memory
// wiring exclude those hits at retrieval until the re-tag lands, WITHOUT
// MemoryService importing the workspace/scope stores (it stays a platform leaf,
// mirroring the resolver seams above). Returns `true` to EXCLUDE a hit.
export type RetrievalHitFilter = (hit: RagHit) => boolean;

/** Default: exclude nothing. */
const NO_HIT_EXCLUSION: RetrievalHitFilter = () => false;

let excludeHitFromRetrieval: RetrievalHitFilter = NO_HIT_EXCLUSION;

/** Install the retrieval exclusion predicate. Called from `useMemoryWiring`
 *  with a closure over the pending/failed matter re-tag folders. */
export function setRetrievalHitExclusion(filter: RetrievalHitFilter): void {
  excludeHitFromRetrieval = filter;
}

/** Reset to the exclude-nothing default. Test helper. */
export function resetRetrievalHitExclusion(): void {
  excludeHitFromRetrieval = NO_HIT_EXCLUSION;
}

/**
 * Meeting files carry a manifest in their sibling meeting.json.  The meetings
 * feature installs this batch resolver because the platform memory layer must
 * not import a feature. `not-meeting` is the only allow result for an ordinary
 * file; `hidden` is removed from both indexing and retrieval.
 */
export type MeetingFileVisibilityResolution =
  | 'not-meeting'
  | 'visible'
  | 'hidden';
export type MeetingFileVisibilityResolver = (
  sourceIds: readonly string[],
  meetingDerivedSourceIds: ReadonlySet<string>
) => Promise<ReadonlyMap<string, MeetingFileVisibilityResolution>>;

const NO_MEETING_FILE_RESOLVER: MeetingFileVisibilityResolver = (
  sourceIds,
  meetingDerivedSourceIds
) =>
  Promise.resolve(
    new Map(
      sourceIds.map((sourceId) => [
        sourceId,
        meetingDerivedSourceIds.has(sourceId) ? 'hidden' : 'not-meeting',
      ] as const)
    )
  );

let resolveMeetingFileVisibility: MeetingFileVisibilityResolver =
  NO_MEETING_FILE_RESOLVER;
let meetingFileVisibilityResolverInstalled = false;

export function setMeetingFileVisibilityResolver(
  resolver: MeetingFileVisibilityResolver
): void {
  resolveMeetingFileVisibility = resolver;
  meetingFileVisibilityResolverInstalled = true;
}

export function resetMeetingFileVisibilityResolver(): void {
  resolveMeetingFileVisibility = NO_MEETING_FILE_RESOLVER;
  meetingFileVisibilityResolverInstalled = false;
}

async function removeHiddenMeetingSources(sourceIds: readonly string[]): Promise<void> {
  await Promise.all(
    [...new Set(sourceIds)].map(async (sourceId) => {
      try {
        await ragDeletePath(sourceId);
      } catch (err) {
        // Retrieval remains fail-closed even if stale-row cleanup needs a
        // later retry. Never put a hidden hit back because deletion failed.
        console.warn(`[memory] could not remove hidden meeting source ${sourceId}:`, err);
      }
    })
  );
}

/**
 * Fresh meeting visibility check used by retrieve and again by Ask immediately
 * before prompt/citation construction. A resolver failure hides the whole
 * candidate set: inability to prove current meeting visibility is not consent.
 */
export async function filterMeetingFileVisibilityHits(
  hits: readonly RagHit[]
): Promise<RagHit[]> {
  if (hits.length === 0) return [];
  const sourceIds = hits.map((hit) => hit.sourceId ?? hit.path);
  // Without feature wiring the platform cannot prove that an ordinary-looking
  // row is not a protected meeting file. Hide and purge every candidate rather
  // than relying on a possibly stale source_type tag.
  if (!meetingFileVisibilityResolverInstalled) {
    await removeHiddenMeetingSources(sourceIds);
    return [];
  }
  const meetingDerivedSourceIds = new Set(
    hits
      .filter((hit) => hit.sourceType === 'meeting')
      .map((hit) => hit.sourceId ?? hit.path)
  );
  let decisions: ReadonlyMap<string, MeetingFileVisibilityResolution>;
  try {
    decisions = await resolveMeetingFileVisibility(
      sourceIds,
      meetingDerivedSourceIds
    );
  } catch {
    await removeHiddenMeetingSources(sourceIds);
    return [];
  }
  const hidden = sourceIds.filter((sourceId) => {
    const decision = decisions.get(sourceId);
    return decision !== 'not-meeting' && decision !== 'visible';
  });
  if (hidden.length > 0) await removeHiddenMeetingSources(hidden);
  return hits.filter((hit) => {
    const decision = decisions.get(hit.sourceId ?? hit.path);
    return decision === 'not-meeting' || decision === 'visible';
  });
}

/**
 * QA-44 — apply both fail-closed filters to a raw hit list, in the SAFE
 * direction only (drop suspect hits; never add any):
 *
 *   1. Privilege (default path only): re-check every hit against the LIVE
 *      privilege store and drop any source it marks privileged, even when the
 *      hit's own index tag is a stale 'none'. This makes privilege enforcement
 *      independent of index-tag freshness — a swallowed/failed privilege re-tag
 *      can no longer leak an attorney-client / work-product source into normal
 *      Ask. Skipped when `includePrivileged` is true (a deliberate opt-in).
 *
 *   2. Matter/client (both paths): drop any hit the installed exclusion
 *      predicate marks, so a file whose folder re-tag is pending/failed cannot
 *      surface under the wrong client. Applies even on the include-privileged
 *      path — opting into privileged content is never opting into wrong-client
 *      content.
 */
function applyFailClosedExclusions(hits: RagHit[], includePrivileged: boolean): RagHit[] {
  let out = hits;
  if (!includePrivileged) {
    // Fail closed across path forms: drop the hit if ANY equivalent form of its
    // source id resolves to a privileged status (the privilege store may key the
    // source by a different form than the hit carries).
    out = out.filter((hit) => {
      const id = hit.sourceId ?? hit.path;
      return sourceIdForms(id).every((form) => resolvePrivilegeForPath(form) === 'none');
    });
  }
  if (excludeHitFromRetrieval !== NO_HIT_EXCLUSION) {
    out = out.filter((hit) => !excludeHitFromRetrieval(hit));
  }
  return out;
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
 * F-301 guard: the shared default (whole-workspace) reconcile promise. Every
 * overlapping caller awaits the SAME run. Returning early here is unsafe: the
 * caller would believe the table was stable and could start PDF work while the
 * first reconcile was still replacing it.
 */
type WorkspaceIndexRun = {
  workspaceKey: string | null;
  activation: number;
  promise: Promise<void>;
};

let activeWorkspaceKey: string | null = null;
let workspaceActivation = 0;
let nativeWorkspaceActivation = 0;
let workspaceIndexInFlight: WorkspaceIndexRun | null = null;

function normalizeWorkspaceKey(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export const MemoryService = {
  filterMeetingFileVisibilityHits,
  setMeetingFileVisibilityResolver,
  resetMeetingFileVisibilityResolver,
  /** Point the indexer at a workspace. Always runs even if disabled — the
   *  workspace handle is metadata, not user data. */
  async setWorkspace(path: string): Promise<void> {
    nativeWorkspaceActivation = await ragSetWorkspace(path);
    const nextWorkspaceKey = normalizeWorkspaceKey(path);
    if (activeWorkspaceKey !== nextWorkspaceKey) {
      activeWorkspaceKey = nextWorkspaceKey;
      workspaceActivation += 1;
    }
  },

  async indexFile(path: string, matterId?: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    if (!meetingFileVisibilityResolverInstalled) {
      await removeHiddenMeetingSources([path]);
      return;
    }
    let decision: MeetingFileVisibilityResolution | undefined;
    try {
      decision = (
        await resolveMeetingFileVisibility([path], new Set<string>())
      ).get(path);
    } catch {
      decision = 'hidden';
    }
    if (decision !== 'not-meeting' && decision !== 'visible') {
      await removeHiddenMeetingSources([path]);
      return;
    }
    // WS-B/C: tag the chunk with the matter this file belongs to so retrieval
    // can prefilter by matter. Resolves to "unassigned" when the file is not
    // under any matter's mapped folders. Callers that already know the matter
    // (meeting post-processing, for example) can pass it directly so indexing
    // does not depend on folder-watcher timing or folder inference.
    // WS-PRIV: also tag with the source's privilege so privileged content is
    // excluded from default retrieval. Resolves to "none" when not tagged.
    await ragIndexFile(
      path,
      matterId ?? resolveMatterForPath(path),
      resolvePrivilegeForPath(path),
      decision === 'visible' ? 'meeting' : undefined
    );
  },

  /** Meeting writers use this doorway so the native row carries durable
   * `source_type=meeting` provenance. Missing/reset visibility wiring refuses
   * the index operation instead of treating the file as ordinary. */
  async indexMeetingFile(path: string, matterId: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    if (!meetingFileVisibilityResolverInstalled) {
      await removeHiddenMeetingSources([path]);
      return;
    }
    let decision: MeetingFileVisibilityResolution | undefined;
    try {
      decision = (
        await resolveMeetingFileVisibility([path], new Set([path]))
      ).get(path);
    } catch {
      decision = 'hidden';
    }
    if (decision !== 'visible') {
      await removeHiddenMeetingSources([path]);
      return;
    }
    await ragIndexFile(
      path,
      matterId,
      resolvePrivilegeForPath(path),
      'meeting'
    );
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
    // A native walk can encounter meeting folders. Without the feature's exact
    // file resolver, there is no safe way to distinguish them from normal CRM
    // files, so defer the whole walk until wiring is installed.
    if (!meetingFileVisibilityResolverInstalled) return;
    if (matterId === undefined) {
      const requestedWorkspace = activeWorkspaceKey;
      const requestedActivation = workspaceActivation;
      let activeRun = workspaceIndexInFlight;
      while (activeRun !== null) {
        try {
          await activeRun.promise;
        } catch (err) {
          if (
            activeRun.workspaceKey === requestedWorkspace &&
            activeRun.activation === requestedActivation
          ) {
            throw err;
          }
        }
        if (workspaceIndexInFlight === activeRun) workspaceIndexInFlight = null;
        if (
          activeRun.workspaceKey === requestedWorkspace &&
          activeRun.activation === requestedActivation
        ) {
          return;
        }
        // This caller belongs to the workspace that is still active. A run
        // for another workspace finishing does not count as its reconcile.
        if (
          activeWorkspaceKey !== requestedWorkspace ||
          workspaceActivation !== requestedActivation
        ) {
          return;
        }
        activeRun = workspaceIndexInFlight;
      }
      if (
        activeWorkspaceKey !== requestedWorkspace ||
        workspaceActivation !== requestedActivation
      ) {
        return;
      }

      // P1.1 — the default boot index is now a cheap RECONCILE: it skips files
      // whose signature is unchanged in the manifest and only re-embeds new /
      // changed ones (falling back to a full rebuild on a schema migration).
      // This is what makes a warm boot near-instant instead of a full re-embed.
      const entry: WorkspaceIndexRun = {
        workspaceKey: requestedWorkspace,
        activation: requestedActivation,
        promise: ragReconcileWorkspace(matterId),
      };
      workspaceIndexInFlight = entry;
      try {
        await entry.promise;
      } finally {
        if (workspaceIndexInFlight === entry) workspaceIndexInFlight = null;
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
   * matter id. One bad file never aborts the batch — but the number of files
   * that FAILED is returned (QA-44) so the caller can keep the folder excluded
   * from retrieval and retry, rather than treating a partial re-tag as a clean
   * success (which would drop the exclusion while some chunks still carry the
   * OLD, wrong-client matter tag).
   */
  async reindexPaths(paths: string[], matterId: string): Promise<number> {
    if (!isMemoryEnabled()) return 0;
    if (!meetingFileVisibilityResolverInstalled) {
      await removeHiddenMeetingSources(paths);
      return paths.length;
    }
    let failed = 0;
    for (const path of paths) {
      try {
        let decision: MeetingFileVisibilityResolution | undefined;
        try {
          decision = (await resolveMeetingFileVisibility([path], new Set())).get(path);
        } catch {
          decision = 'hidden';
        }
        if (decision !== 'not-meeting' && decision !== 'visible') {
          await removeHiddenMeetingSources([path]);
          failed += 1;
          continue;
        }
        // WS-PRIV: preserve each file's privilege across a matter re-index so a
        // matter remap never silently un-privileges a source.
        await ragIndexFile(
          path,
          matterId,
          resolvePrivilegeForPath(path),
          decision === 'visible' ? 'meeting' : undefined
        );
      } catch {
        // Skip this file and continue the batch, but remember it failed.
        failed += 1;
      }
    }
    return failed;
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
   *
   * QA-92: returns the paths that STILL have no rows under `matterId` after the
   * retag (never-indexed / path-form mismatch), so the caller re-indexes exactly
   * those. Empty when memory is off or there are no paths.
   */
  async retagMatterBatch(sourceIds: string[], matterId: string): Promise<string[]> {
    if (!isMemoryEnabled() || sourceIds.length === 0) return [];
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
    const hits = await retrievalBackend(
      query,
      topK,
      scope,
      includePrivileged,
      perSourceCap,
      enableReranker,
      enableHybridSearch,
    );
    // QA-44: fail closed on privilege and wrong-client exposure regardless of
    // whether a prior re-tag ever landed (a swallowed/failed re-tag left stale
    // tags in the index).
    return filterMeetingFileVisibilityHits(
      applyFailClosedExclusions(hits, includePrivileged)
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
    expectedWorkspace: string,
  ): Promise<{ indexed: boolean; pageCount: number; reason?: string }> {
    if (!isMemoryEnabled()) {
      return { indexed: false, pageCount: 0, reason: 'memory-disabled' };
    }
    if (!isPdfIndexingEnabled()) {
      return { indexed: false, pageCount: 0, reason: 'pdf-indexing-disabled' };
    }
    if (!meetingFileVisibilityResolverInstalled) {
      await removeHiddenMeetingSources([path]);
      return { indexed: false, pageCount: 0, reason: 'visibility-unavailable' };
    }
    let visibility: MeetingFileVisibilityResolution | undefined;
    try {
      visibility = (
        await resolveMeetingFileVisibility([path], new Set<string>())
      ).get(path);
    } catch {
      visibility = 'hidden';
    }
    if (visibility !== 'not-meeting' && visibility !== 'visible') {
      await removeHiddenMeetingSources([path]);
      return { indexed: false, pageCount: 0, reason: 'meeting-hidden' };
    }
    // Capture the native opening id BEFORE reading or slow OCR starts. The path
    // alone is not enough for A → B → A; the first A must not write into the
    // second A.
    const expectedActivation = nativeWorkspaceActivation;

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
    const ocrEnabled = isOcrScannedPdfsEnabled();
    const matterId = resolveMatterForPath(path);
    const privilege = resolvePrivilegeForPath(path);
    const recordPdfReceipt = async (emptyIndex: boolean): Promise<void> => {
      await ragManifestRecordPdf(
        path,
        result.pageCount,
        ocrEnabled,
        expectedWorkspace,
        expectedActivation,
        matterId,
        privilege,
        emptyIndex,
      );
    };
    const recordKnownEmptyPdf = async (): Promise<boolean> => {
      // Remove rows from an older readable version before saving the explicit
      // empty receipt. Never save that receipt after a failed delete: stale rows
      // could still carry an older client's scope and must stay fail-closed.
      try {
        await ragDeletePdfPath(path, expectedWorkspace, expectedActivation);
      } catch (err) {
        console.warn(`[memory] could not clear stale rows for empty PDF ${path}:`, err);
        return false;
      }
      await recordPdfReceipt(true);
      return true;
    };
    const invalidateIncompletePdf = async (): Promise<void> => {
      try {
        await ragManifestForgetPdf(path, expectedWorkspace, expectedActivation);
      } catch (err) {
        // Receipt removal is correctness-significant. If it fails, remove the
        // partial rows too; the old non-empty receipt then cannot pass the next
        // launch's row-presence check. The native side also tombstones the path.
        try {
          await ragDeletePdfPath(path, expectedWorkspace, expectedActivation);
        } catch (deleteErr) {
          console.warn(`[memory] could not remove partial PDF rows ${path}:`, deleteErr);
        }
        throw err;
      }
    };

    if (result.encrypted) {
      await recordKnownEmptyPdf();
      return { indexed: false, pageCount: result.pageCount, reason: 'encrypted' };
    }

    // VG-2 — the OCR pipeline. Per-page scanned-ness (not the whole-file
    // flag) so a mixed native/scanned filing OCRs only its scanned pages.
    let pages = result.pages;
    let pageConfidences: (number | undefined)[] | undefined;
    let ocrNeedsRetry = false;
    const ocrPageIndices = result.pages
      .map((pageText, index) => (pdfExtract.pageNeedsOcr(pageText) ? index : -1))
      .filter((index) => index >= 0);
    if (ocrPageIndices.length > 0) {
      const ocr = await import('@/platform/rag/ocr/ocrEngine');
      if (ocrEnabled && ocr.isOcrEngineAvailable()) {
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
              ocrNeedsRetry = true;
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
        // Deliberately disabling OCR is a stable, checked-empty outcome. An OCR
        // engine that is unexpectedly unavailable is temporary and must retry.
        if (ocrEnabled) {
          try {
            await ragDeletePdfPath(path, expectedWorkspace, expectedActivation);
          } catch (err) {
            console.warn(`[memory] could not clear stale rows while OCR waits ${path}:`, err);
          }
          await invalidateIncompletePdf();
        } else {
          await recordKnownEmptyPdf();
        }
        return { indexed: false, pageCount: result.pageCount, reason: 'scanned' };
      } else if (ocrEnabled) {
        // Keep the native pages searchable, but don't mark this mixed PDF fully
        // checked. Its scanned pages still need OCR on a later launch.
        ocrNeedsRetry = true;
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
        if (ocrNeedsRetry) {
          // A broken render/OCR attempt is temporary, not proof that the PDF is
          // permanently empty. Clear any stale rows, but leave no fresh receipt
          // so the next launch tries again after the engine recovers.
          try {
            await ragDeletePdfPath(path, expectedWorkspace, expectedActivation);
          } catch (err) {
            console.warn(`[memory] could not clear stale rows after OCR failure ${path}:`, err);
          }
          await invalidateIncompletePdf();
        } else {
          await recordKnownEmptyPdf();
        }
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
    const chunksStored = await ragIndexPdfChunks(
      path,
      pages,
      result.pageCount,
      expectedWorkspace,
      expectedActivation,
      matterId,
      privilege,
      pageConfidences,
    );
    // P1.1 / Finding #19: always save the outcome of a successful check. An
    // explicit empty receipt lets unchanged, safely-unsearchable PDFs stay
    // quiet across restarts without confusing them with accidentally lost rows.
    if (!ocrNeedsRetry) {
      await recordPdfReceipt(chunksStored === 0);
    } else {
      await invalidateIncompletePdf();
    }
    return {
      indexed: chunksStored > 0,
      pageCount: result.pageCount,
    };
  },

  /** Remove all stored chunks for the given PDF file paths. Called when
   *  the user turns OFF the `includePdfsInWorkspaceIndex` toggle. Best-effort
   *  — errors are silently swallowed since this is housekeeping. */
  async deleteAllPdfChunks(filePaths: string[], expectedWorkspace: string): Promise<void> {
    if (!isMemoryEnabled()) return;
    const expectedActivation = nativeWorkspaceActivation;
    for (const path of filePaths) {
      try {
        await ragDeletePdfPath(path, expectedWorkspace, expectedActivation);
      } catch {
        // Best-effort: swallow and keep going.
      }
    }
    // P1.1 (Task 3): the PDF rows are gone, so drop their manifest signatures too.
    // Otherwise a later toggle-ON would see them "fresh" and skip re-indexing,
    // silently dropping those PDFs from search until each file changes.
    await ragManifestForgetPdfs(expectedWorkspace, expectedActivation);
  },
};

export type { RagHit };
