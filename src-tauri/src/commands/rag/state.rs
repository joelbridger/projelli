use super::*;

/// Date metadata carried with a retrieval result. This mirrors the frontend's
/// `SourceDate` contract exactly; the values describe the original source, not
/// when Lantern happened to index it.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceDateKind {
    Effective,
    Received,
    Sent,
    Created,
    Updated,
    EventStart,
    DocumentModified,
    SnapshotExported,
    Unknown,
}

/// How the date was obtained.  This is a closed IPC contract: callers cannot
/// accidentally label a locally-derived file timestamp as source evidence.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SourceDateConfidence {
    Source,
    Derived,
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DateConflictKind {
    ConflictingDatedEvidence,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DateConflictRelation {
    NewerConflictsWithOlder,
    OlderConflictsWithNewer,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDate {
    /// RFC 3339 when the source supplied a safely parseable timestamp.
    pub value: Option<String>,
    /// `received`, `created`, `updated`, or `document-modified` for producers
    /// currently available in the Rust retrieval path.
    pub kind: SourceDateKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_value: Option<String>,
    /// Directly read from the mail, CRM, or file metadata source.
    pub confidence: SourceDateConfidence,
}

/// Optional adapter-owned fact metadata. The retrieval producer does not infer
/// facts; it only preserves this shape for a source that supplies one.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatedFact {
    pub key: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatedEvidence {
    pub source_id: String,
    pub path: String,
    pub value: String,
    pub source_date: SourceDate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DateConflictFlag {
    pub kind: DateConflictKind,
    pub fact_key: String,
    pub relation: DateConflictRelation,
    pub evidence: Vec<DatedEvidence>,
}

/// One result row returned by `rag_retrieve`. The shape is frozen in Phase
/// 2 so frontend UI can be built against it:
///   - `path`: absolute path of the source file
///   - `chunk_text`: the matching paragraph / chunk of text (verbatim)
///   - `score`: cosine similarity in `[0.0, 1.0]` — higher is better
///   - `paragraph_index`: zero-based index of the chunk within its file
///     (so the UI can deep-link and anchor to it)
///
/// A3 additions:
///   - `source_type`: `"text"` | `"pdf"` | `"mail"` — absent on pre-A3 rows (null)
///   - `page_number`: 1-based page number for PDF chunks; absent on text/pre-A3 rows
///
/// WS-B/C additions (camelCase over IPC: `matterId`, `sourceId`):
///   - `matter_id`: the confidentiality scope the chunk belongs to. Always
///     present post-3.0 (the migration re-indexes pre-3.0 rows). `id` is the
///     content-addressed citation key the answer layer cites and verify resolves.
///   - `source_id`: the resolvable originating source (file path or
///     `mail:<message-id>`) the citation points at.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub chunk_text: String,
    pub score: f32,
    pub paragraph_index: u32,
    // WS-B/C: the content-addressed chunk id — the citation key. Optional so a
    // stray pre-3.0 row (no id read) still serializes; present for all real hits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    // WS-B/C: confidentiality scope key + resolvable source id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matter_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    // A3: Optional so pre-A3 rows serialize cleanly (null in JS).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<u32>,
    // WS-PRIV: the chunk's privilege status ("none" | "attorney-client" |
    // "work-product"). Present post-WS-PRIV; Optional so a stray pre-WS-PRIV row
    // still serializes. Default retrieval only ever returns "none"; this is
    // surfaced so an explicitly-included privileged hit can be labelled in the UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privilege: Option<String>,
    // VG-2: `"ocr"` when the chunk text was read from a scanned page by the
    // local OCR engine; absent on native chunks. Camel-cases to `extraction`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extraction: Option<String>,
    // VG-2: mean OCR word confidence (0-100) for the chunk's page; absent on
    // native chunks. Camel-cases to `extractionConfidence`. The UI discloses
    // values below OCR_LOW_CONFIDENCE = 60 as a low-confidence scan.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extraction_confidence: Option<f32>,
    // VG-3c: page:line locator for certified deposition transcript chunks
    // ("startPage:startLine-endPage:endLine", e.g. "45:12-46:3"); absent on
    // every other source. The UI prefers it for the citation label:
    // "Tr. 45:12-46:3". Metadata ON TOP of the unchanged `paragraph_index`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locator: Option<String>,
    // B1: producer-side date contract. Retrieval fills adapter-owned record
    // timestamp identities for mail and CRM and flags differing timestamps on
    // matching copies of that same record before IPC. This is not general
    // cross-document fact extraction. File-only sources honestly omit
    // `dated_fact` when no source adapter owns a stable record identity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_date: Option<SourceDate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dated_fact: Option<DatedFact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_conflict: Option<DateConflictFlag>,
}

/// WS-B/C — the REQUIRED retrieval scope. Confidentiality is enforced here: a
/// caller cannot omit scope and silently search every matter. There are exactly
/// two encodings, serialized as an internally-tagged JSON object so the frontend
/// must name its intent:
///
///   `{ "kind": "matter", "matterId": "<id>" }` — scope to ONE matter. Applied
///       as a LanceDB prefilter; the only path used for normal client work.
///   `{ "kind": "allMatters" }` — a DELIBERATE, separately-named cross-matter
///       capability (e.g. a conflicts check). Never the default, never reachable
///       by simply leaving scope out. Callers that use it should audit it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RetrievalScope {
    /// Restrict to a single matter (prefilter on `matter_id`).
    Matter {
        #[serde(rename = "matterId")]
        matter_id: String,
    },
    /// Explicit cross-matter search. Audited capability, not a default.
    AllMatters,
}

/// WS-B/C — the verdict from `rag_verify_citation`. The app refuses to present
/// any answer whose citation does not return `Verified`.
///
/// Serialized as an internally-tagged object so the frontend can switch on
/// `verdict` and surface a reason:
///   `{ "verdict": "verified" }`
///   `{ "verdict": "notFound" }`                    — id doesn't exist (fabricated/stale)
///   `{ "verdict": "matterMismatch", "actualMatter": "<id>" }` — exists, wrong matter
///   `{ "verdict": "textMismatch" }`                — exists in matter, quote not present
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "verdict", rename_all = "camelCase")]
pub enum Verdict {
    /// Chunk exists, is in the claimed matter, and contains the quoted text.
    Verified,
    /// No chunk with that id exists anywhere (fabricated or stale citation).
    NotFound,
    /// Chunk exists but under a DIFFERENT matter than claimed (a scope lie).
    MatterMismatch {
        #[serde(rename = "actualMatter")]
        actual_matter: String,
    },
    /// Chunk exists in the claimed matter, but the quoted text is not present
    /// (the answer misquoted / hallucinated the source).
    TextMismatch,
}

/// Payload emitted on `rag-indexing-progress` Tauri events. The frontend
/// `useRagStatus` hook subscribes and renders a banner / status badge.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexingProgress {
    pub status: IndexingStatus,
    pub processed: u32,
    pub total: u32,
    pub current_path: Option<String>,
    /// BUG-099: how many files were genuinely skipped (extraction/embed failed
    /// or timed out). Equals `failed` + `timed_out`. Cumulative on per-file
    /// `Indexing` events; final on the terminal `Done` / `Cancelled` event.
    /// The banner uses `indexed = total - skipped` to report the honest count.
    /// NOTE: `cleanup_failed` is a SEPARATE counter — a file whose cleanup also
    /// fails is still only counted ONCE here (not double-counted).
    pub skipped: u32,
    /// Of `skipped`: files dropped because extraction/embedding returned an
    /// unrecoverable error.
    pub failed: u32,
    /// Of `skipped`: files dropped because they exceeded the per-file index
    /// timeout (a stuck parser or blocking embedder — the original BUG-099 stall).
    pub timed_out: u32,
    /// BUG-099: files for which the stale-row cleanup DELETE also failed after
    /// the skip. These are ALREADY counted in `skipped`/`failed`/`timed_out`
    /// above — this is a SEPARATE counter for the additional failure (cleanup
    /// itself failed) so the UI can say "N files could not be cleaned up."
    /// Using a distinct counter prevents the double-count that was undercounting
    /// indexed files (the UI banner's `indexed = total - skipped` was wrong when
    /// PurgeFailed incremented `skipped` twice for the same file).
    #[serde(skip_serializing_if = "is_zero")]
    pub cleanup_failed: u32,
    /// The paths that were skipped. Omitted from the wire payload when empty so
    /// the per-file events stay small; populated (bounded by
    /// `MAX_REPORTED_SKIPPED_PATHS`) on the terminal event so the UI can list them.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub skipped_paths: Vec<String>,
    /// P1.1 (Task 2) — true ONLY while a real one-time SCHEMA MIGRATION rebuild is
    /// running (the vector store predates the current `INDEX_VERSION`). The banner
    /// says an honest "Upgrading search index…" in that case, distinct from a
    /// routine boot reconcile. False for every normal reconcile / incremental walk.
    #[serde(skip_serializing_if = "is_false")]
    pub migrating: bool,
    /// P1.1 (Task 4) — files a boot reconcile SKIPPED because their signature was
    /// unchanged (the whole point: work avoided). Cumulative; final on the terminal
    /// event. Zero on a cold/full walk.
    #[serde(skip_serializing_if = "is_zero")]
    pub reused: u32,
    /// P1.1 (Task 4) — files a boot reconcile actually re-extracted/re-embedded
    /// because they were new or changed. On a full walk this equals `total`.
    #[serde(skip_serializing_if = "is_zero")]
    pub reindexed: u32,
    /// P1.1 (Task 4) — sources whose rows were purged because the file was deleted
    /// from disk since the last index.
    #[serde(skip_serializing_if = "is_zero")]
    pub deleted: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Idle / Error are valid wire values even if not currently emitted
pub enum IndexingStatus {
    #[default]
    Idle,
    /// P1.1 (Task 4) — the cheap stat-walk phase of a boot reconcile: comparing
    /// each file against the manifest to decide what changed. No extraction or
    /// embedding happens here, so it is fast even on large workspaces.
    Checking,
    Indexing,
    Done,
    Cancelled,
    Error,
}

/// Tauri event name. Mirrored in `src/utils/tauri-commands.ts`.
pub const PROGRESS_EVENT: &str = "rag-indexing-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentInvalidated {
    pub source: String,
    pub deleted: u32,
}

/// Tauri event name. Mirrored in `src/utils/tauri-commands.ts`.
pub const CONTENT_INVALIDATED_EVENT: &str = "rag-content-invalidated";

/// BUG-099 hardening: a single pathological file must not hold the whole
/// workspace walk forever. Five minutes is intentionally generous for normal
/// text/office sources under the existing size caps (5 MiB text, 50 MiB office)
/// while still giving the Windows bench a clear skip instead of an infinite
/// "20/21 files" stall.
pub(crate) const WORKSPACE_FILE_INDEX_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// BUG-099: cap how many skipped paths ride the terminal progress event. The
/// exact skip/fail/timeout COUNTS are always reported; this only bounds the path
/// LIST so a pathological workspace (everything failing) can't emit a giant
/// payload. The UI shows the first N and relies on the counts for the total.
const MAX_REPORTED_SKIPPED_PATHS: usize = 100;

/// Result of indexing bytes downloaded by an external document connector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadedDocumentIndexOutcome {
    Indexed(u32),
    PendingPdf,
    Unsupported,
    Cancelled,
}

/// Additive helper for document connectors that download bytes from an external
/// system and need to index them through the same encrypted, matter-scoped RAG
/// path as local files.
///
/// PDF is deliberately not handled here because the current PDF text extractor
/// is renderer-side (`src/lib/pdf-extract.ts`). The connector stores PDF
/// metadata as pending and can index it once a Rust-side PDF text path exists.
#[allow(clippy::too_many_arguments)]
pub async fn index_downloaded_document_bytes(
    table: &lancedb::Table,
    source_id: &str,
    filename: &str,
    bytes: &[u8],
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
    cancel: Option<&AtomicBool>,
) -> anyhow::Result<DownloadedDocumentIndexOutcome> {
    index_downloaded_document_bytes_as_source_type(
        table, source_id, filename, bytes, matter_id, privilege, key, cancel, "onedrive",
    )
    .await
}

/// Same as `index_downloaded_document_bytes`, but lets a document connector
/// name its own source type (`onedrive`, `box`, `sharefile`, etc.) while reusing
/// the same extraction, embedding, encryption, and stale-row deletion path.
/// Shared by all document connectors (Box and ShareFile both call it).
#[allow(clippy::too_many_arguments)]
pub async fn index_downloaded_document_bytes_as_source_type(
    table: &lancedb::Table,
    source_id: &str,
    filename: &str,
    bytes: &[u8],
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
    cancel: Option<&AtomicBool>,
    source_type: &str,
) -> anyhow::Result<DownloadedDocumentIndexOutcome> {
    use anyhow::Context;

    store::validate_external_source_type(source_type).context("validate downloaded source_type")?;

    if let Some(flag) = cancel {
        if flag.load(Ordering::SeqCst) {
            return Ok(DownloadedDocumentIndexOutcome::Cancelled);
        }
    }

    let lower = filename.to_ascii_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    let text = match ext {
        "docx" => lantern_docx::parse_docx_bytes(bytes)
            .map(|doc| lantern_docx::extract_paragraph_texts(&doc).join("\n\n"))
            .map_err(anyhow::Error::from)
            .context("extract downloaded docx")?,
        "xlsx" => office::extract_xlsx_sections(bytes)
            .context("extract downloaded xlsx")?
            .into_iter()
            .map(|s| format!("Sheet {} - {}\n{}", s.number, s.label, s.text))
            .collect::<Vec<_>>()
            .join("\n\n"),
        "pptx" => office::extract_pptx_sections(bytes)
            .context("extract downloaded pptx")?
            .into_iter()
            .map(|s| format!("Slide {} - {}\n{}", s.number, s.label, s.text))
            .collect::<Vec<_>>()
            .join("\n\n"),
        "rtf" => office::extract_rtf_text(bytes).context("extract downloaded rtf")?,
        "txt" | "text" | "md" | "markdown" => String::from_utf8(bytes.to_vec())
            .map_err(|_| anyhow::anyhow!("downloaded text document is not valid UTF-8"))?,
        // These two arms are DETERMINISTIC (no extraction step that could fail),
        // so deleting stale chunks first is safe and necessary: a source that
        // used to be indexable (e.g. a .docx) and is now a scanned PDF or an
        // unsupported type must not keep its old chunks searchable. (The text
        // arms below delete only after a SUCCESSFUL extraction, so an extraction
        // error can never wipe a previously-good index.)
        "pdf" => {
            store::delete_path(table, source_id, key)
                .await
                .context("delete stale chunks for now-pending PDF")?;
            return Ok(DownloadedDocumentIndexOutcome::PendingPdf);
        }
        _ => {
            store::delete_path(table, source_id, key)
                .await
                .context("delete stale chunks for now-unsupported document")?;
            return Ok(DownloadedDocumentIndexOutcome::Unsupported);
        }
    };

    store::delete_path(table, source_id, key)
        .await
        .context("delete stale downloaded-document chunks")?;

    if text.trim().is_empty() {
        return Ok(DownloadedDocumentIndexOutcome::Indexed(0));
    }

    let chunks = chunker::chunk_text(source_id, &text);
    if chunks.is_empty() {
        return Ok(DownloadedDocumentIndexOutcome::Indexed(0));
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel)
        .await
        .context("embed downloaded document chunks")?
    else {
        return Ok(DownloadedDocumentIndexOutcome::Cancelled);
    };
    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    if rows.is_empty() {
        return Ok(DownloadedDocumentIndexOutcome::Indexed(0));
    }

    let batch = store::build_batch_external(&rows, key, matter_id, privilege, source_type)
        .context("build downloaded document batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    let _write = store::acquire_write_access(table).await?;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add downloaded document chunks to lancedb")?;

    Ok(DownloadedDocumentIndexOutcome::Indexed(rows.len() as u32))
}

/// BUG-099: bound the skipped-path list that rides a terminal progress event.
pub(crate) fn cap_skipped_paths(paths: &[String]) -> Vec<String> {
    paths
        .iter()
        .take(MAX_REPORTED_SKIPPED_PATHS)
        .cloned()
        .collect()
}

/// Shared state managed by Tauri. Holds:
///   - the currently-active workspace root (so `rag_index_workspace` and
///     incremental file-change handlers know where to walk),
///   - a cancellation flag the in-flight workspace indexer polls,
///   - a "full index pending" latch that makes the default full-workspace walk
///     run AT MOST ONCE per workspace activation (see `rag_index_workspace` —
///     F-301 OOM guard).
#[derive(Default)]
pub struct RagState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub cancel_flag: Arc<AtomicBool>,
    /// Latch armed by `rag_set_workspace` and consumed by the first default
    /// (`matter_id = None`) `rag_index_workspace` call. Subsequent default calls
    /// for the SAME activation are no-ops.
    ///
    /// Why (F-301): the default full walk is fired on every workspace open. The
    /// dev Vite HMR reload-storm (parallel agents writing repo artifacts) reset
    /// the webview to the selector repeatedly, and re-opening re-fired the walk —
    /// dozens of times in seconds. Each walk runs the destructive pre-3.0
    /// migration (`drop_table` + full re-index) because the version marker is
    /// only written at the END of a successful walk; the rapid drop/recreate
    /// churn corrupted the LanceDB dataset and triggered a flood of panics
    /// (`lance dataset.rs:496` "range end index … out of range") whose unwinds
    /// leaked memory until the kernel OOM-killed the process (~24 GB). Running
    /// the full walk once per activation keeps it to a single clean pass;
    /// incremental edits are still picked up by the file-watcher → `indexFile`.
    /// See docs/quality/2026-06-10-v3-usability-campaign/leak-investigation.md.
    pub full_index_pending: Arc<AtomicBool>,
    /// True while a `rag_index_workspace` walk is running. A second call that
    /// arrives while one is in flight coalesces (returns immediately) rather than
    /// running a SECOND walk concurrently on the same LanceDB dataset. Two
    /// overlapping walks mutate/`drop_table` the dataset at once, which is what
    /// corrupts it (the `lance dataset.rs:496` panic). The latch above bounds
    /// re-fires across activations; this bounds true overlap WITHIN one (e.g. a
    /// reload re-arms the latch via `rag_set_workspace` while a slow walk on a
    /// large workspace is still running). Reset by `IndexingGuard` on every exit.
    pub indexing: Arc<AtomicBool>,
    /// BUG-099 durable tombstone: the set of HMAC PATH TOKENS (the at-rest
    /// `path` column value) whose stale-row cleanup DELETE failed. Retrieval and
    /// citation verification exclude every token in this set via `path NOT IN
    /// (...)` on the prefilter. A token is removed when its file re-indexes
    /// cleanly — self-healing, surgical (only the one bad file's rows are
    /// suppressed). Mirrored DURABLY to `.unsafe_paths` on disk (as tokens, never
    /// plaintext paths), and re-hydrated on workspace open, so the exclusion
    /// survives an app restart.
    pub unsafe_tokens: Arc<Mutex<HashSet<String>>>,
    /// BUG-099 fail-closed: set true when the durable tombstone file EXISTS but
    /// could NOT be read on workspace open (corruption / lock / permission). The
    /// real unsafe-token set is then unknown, so retrieval and citation
    /// verification REFUSE to serve (return an error / NotFound) rather than
    /// assume "no tombstones" and risk citing a stale row. Cleared by a clean
    /// full walk, which rewrites the tombstone file from scratch.
    pub index_integrity_unknown: Arc<AtomicBool>,
    /// WS3d-B — the in-memory BM25 KEYWORD index for hybrid retrieval. Empty
    /// until the first hybrid (`enableHybridSearch`) query, which lazily loads it
    /// from disk or rebuilds it from the vector store. When the flag is OFF this
    /// is never touched, so retrieval stays byte-for-byte the vector-only path.
    /// The index is rebuilt whenever the LanceDB dataset version it was built at
    /// no longer matches the live table version (any writer bumps that version),
    /// so it self-heals without a hook in every indexing path. NOT the security
    /// boundary — every chunk it proposes is re-fetched through the same scoped
    /// predicate the vector pass uses.
    pub bm25: Arc<Mutex<bm25_index::Bm25Index>>,
    /// P2.1 (Finding 3) — true while a BM25 keyword-index rebuild runs in the
    /// BACKGROUND. The old code rebuilt the keyword index ON the query path: a
    /// stale/missing index made the first hybrid query after any corpus change
    /// scan and decrypt the WHOLE corpus under the `bm25` mutex (+0.5–5 s, and it
    /// blocked every other hybrid query meanwhile). Now a stale index makes that
    /// query fall back to vector-only and kick off ONE background rebuild; this
    /// flag coalesces concurrent triggers so only one rebuild runs at a time. The
    /// heavy scan happens WITHOUT holding the `bm25` lock — it locks only briefly
    /// to swap the finished index in. Reset when the rebuild task exits.
    pub bm25_warming: Arc<AtomicBool>,
    /// P1.1 — serializes read-modify-write of the persistent RAG manifest
    /// (`.lantern/rag-manifest-v1.json`). Two writers touch it: the Rust
    /// text/office boot reconcile and the frontend PDF-index path (which records
    /// PDF signatures via `rag_manifest_record_pdf`), and they can run
    /// concurrently. All load→mutate→save sequences hold this lock so neither
    /// clobbers the other's entries. The manifest is a boot-speed cache only —
    /// losing an update never risks a stale ROW, only a needless re-index — so
    /// this lock is about consistency, not a security boundary.
    pub manifest_lock: Arc<Mutex<()>>,
    /// P2.1 (Finding 4) — the cached open `chunks` LanceDB table for the active
    /// workspace. Every Ask used to call `open_connection` + `table_names` +
    /// `open_table` afresh (~10-50 ms, worse on Windows / slow disks); citation
    /// verification repeated the same. We cache the opened `Table` handle keyed by
    /// its workspace path and reuse it across queries.
    ///
    /// STALENESS IS IMPOSSIBLE BY CONSTRUCTION: the connection is opened with a
    /// zero read-consistency interval (`store::open_connection`), so the cached
    /// handle re-checks the latest committed version on every read — writes made
    /// by the indexer through other connections are always visible. The cache is
    /// dropped on a real workspace switch (`cached_chunks_table` re-opens on a path
    /// mismatch) and explicitly before a destructive `drop_table` rebuild
    /// (`invalidate_table_cache`), the only operation a consistency re-check can't
    /// recover from. NOT a security surface — the same matter/privilege/tombstone
    /// prefilters run on every query regardless of where the handle came from.
    pub table_cache: Arc<Mutex<Option<CachedTable>>>,
    /// P2.1 (Finding 4) — monotonic generation counter that closes a TOCTOU race
    /// around a destructive same-workspace rebuild (`drop_table` + recreate). A
    /// concurrent cache-miss could otherwise open the OLD table just before the
    /// drop and store that now-dropped handle AFTER the rebuild's invalidation ran,
    /// poisoning the cache with a stale handle keyed only by the unchanged
    /// workspace path. `invalidate_table_cache` bumps this; a populating read
    /// captures it BEFORE opening and only stores its handle if the generation is
    /// unchanged afterwards — so a handle opened across a rebuild is never cached.
    pub table_cache_gen: Arc<std::sync::atomic::AtomicU64>,
}

/// P2.1 (Finding 4) — a cached open `chunks` table plus the workspace path it was
/// opened for, so a workspace switch is detected and re-opened.
pub struct CachedTable {
    pub workspace: PathBuf,
    pub table: lancedb::Table,
}

/// RAII guard that clears `RagState::indexing` on every exit path (normal
/// return, `?` early-return, panic-unwind) so a failed walk never wedges the
/// concurrency flag permanently "on".
pub(crate) struct IndexingGuard(pub(crate) Arc<AtomicBool>);

impl Drop for IndexingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// RAII re-arm for the once-per-activation full-index latch. A DEFAULT walk
/// (`matter_id == None`) consumes the latch up front; if it then bails during
/// SETUP — before `finalize_walk` gets to decide the latch's fate — the latch
/// would stay `false` and every later default reconcile in the SAME activation
/// short-circuits, so a fail-closed index (e.g. after a transient Windows/LanceDB
/// lock on the forced-rebuild `drop_table`) could only recover on an app/workspace
/// restart. This guard re-arms the latch on such an early bail. Call `disarm()`
/// once setup succeeds, handing the latch decision to `finalize_walk`.
pub(crate) struct RelatchGuard {
    latch: Arc<AtomicBool>,
    armed: bool,
}

impl RelatchGuard {
    pub(crate) fn new(latch: Arc<AtomicBool>) -> Self {
        Self { latch, armed: true }
    }
    pub(crate) fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for RelatchGuard {
    fn drop(&mut self) {
        if self.armed {
            self.latch.store(true, Ordering::SeqCst);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileIndexOutcome {
    Indexed,
    Failed(String),
    TimedOut,
}

/// Run one file's extract+embed job behind a timeout. The job is spawned before
/// waiting so a file that blocks inside synchronous extraction cannot block the
/// outer walk's clock or the final index-version marker write.
/// Still used in tests (the walk now uses `run_file_extract_task`).
#[allow(dead_code)]
pub(crate) async fn run_file_index_task<F>(file: PathBuf, timeout: Duration, fut: F) -> FileIndexOutcome
where
    F: Future<Output = anyhow::Result<()>> + Send + 'static,
{
    let started = Instant::now();
    log::info!(
        "rag_index_workspace: START extract+embed {}",
        file.display()
    );

    let mut handle = tokio::spawn(fut);
    let outcome = match tokio::time::timeout(timeout, &mut handle).await {
        Ok(Ok(Ok(()))) => FileIndexOutcome::Indexed,
        Ok(Ok(Err(e))) => FileIndexOutcome::Failed(format!("{e:#}")),
        Ok(Err(e)) => FileIndexOutcome::Failed(format!("index task join failed: {e}")),
        Err(_) => {
            handle.abort();
            FileIndexOutcome::TimedOut
        }
    };

    let elapsed = started.elapsed();
    match &outcome {
        FileIndexOutcome::Indexed => log::info!(
            "rag_index_workspace: FINISH extract+embed {} in {} ms",
            file.display(),
            elapsed.as_millis()
        ),
        FileIndexOutcome::Failed(e) => log::warn!(
            "rag_index_workspace: SKIP failed file {} after {} ms: {}",
            file.display(),
            elapsed.as_millis(),
            e
        ),
        FileIndexOutcome::TimedOut => log::warn!(
            "rag_index_workspace: SKIP timed-out file {} after {} ms (limit {} ms)",
            file.display(),
            elapsed.as_millis(),
            timeout.as_millis()
        ),
    }

    outcome
}

/// BLOCKER 2 — extract-only variant of the file index task for the workspace
/// walk's single-writer design. The future must NOT perform any DB write; it
/// only extracts text and computes embeddings, returning the data for the
/// parent to write.
///
/// Returns `(FileIndexOutcome, Option<ExtractedFileData>)`:
/// - `(Indexed, Some(data))` — success; parent writes `data` to DB.
/// - `(Indexed, None)` — user cancelled mid-file; parent does nothing.
/// - `(Failed(_), None)` — extraction/embed error; parent calls purge.
/// - `(TimedOut, None)` — task exceeded the timeout; parent calls purge.
///   Crucially, the timed-out task holds no table reference and CANNOT
///   perform a DB write after the parent has cleaned up.
pub(crate) async fn run_file_extract_task<F>(
    file: PathBuf,
    timeout: Duration,
    fut: F,
) -> (FileIndexOutcome, Option<ExtractedFileData>)
where
    F: Future<Output = anyhow::Result<Option<ExtractedFileData>>> + Send + 'static,
{
    let started = Instant::now();
    log::info!(
        "rag_index_workspace: START extract+embed (single-writer) {}",
        file.display()
    );

    let mut handle = tokio::spawn(fut);
    let (outcome, extracted) = match tokio::time::timeout(timeout, &mut handle).await {
        Ok(Ok(Ok(data))) => (FileIndexOutcome::Indexed, data),
        Ok(Ok(Err(e))) => (FileIndexOutcome::Failed(format!("{e:#}")), None),
        Ok(Err(e)) => (FileIndexOutcome::Failed(format!("extract task join failed: {e}")), None),
        Err(_) => {
            handle.abort();
            (FileIndexOutcome::TimedOut, None)
        }
    };

    let elapsed = started.elapsed();
    match &outcome {
        FileIndexOutcome::Indexed => log::info!(
            "rag_index_workspace: FINISH extract+embed {} in {} ms",
            file.display(),
            elapsed.as_millis()
        ),
        FileIndexOutcome::Failed(e) => log::warn!(
            "rag_index_workspace: SKIP failed file {} after {} ms: {}",
            file.display(),
            elapsed.as_millis(),
            e
        ),
        FileIndexOutcome::TimedOut => log::warn!(
            "rag_index_workspace: SKIP timed-out file {} after {} ms (limit {} ms)",
            file.display(),
            elapsed.as_millis(),
            timeout.as_millis()
        ),
    }

    (outcome, extracted)
}

/// BUG-099 blocker 1 — outcome of a stale-row purge attempt.
///
/// The caller uses this to decide whether the file's index state is still
/// trustworthy after a skip:
///
/// * `NotNeeded`    — file was indexed cleanly; no purge was needed.
/// * `PurgedCleanly` — file was skipped AND the delete succeeded; the index is
///                     safe (no stale citation can be served for this file).
/// * `PurgeFailed`  — file was skipped AND the delete FAILED; the index state
///                     for this file is UNSAFE (a stale citation may be served).
///                     The walk counts this as an ADDITIONAL failure and
///                     includes the path in `failed_files` so the UI can say
///                     "N files could not be cleaned up" instead of a silent Done.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PurgeOutcome {
    NotNeeded,
    PurgedCleanly,
    PurgeFailed,
}

/// BUG-099 finding #1 — reconcile the index after one file's outcome.
///
/// A SUCCESSFUL re-index already keeps the index consistent: `index_one_file`
/// deletes the path's old rows and adds the new ones (an upsert). But when a file
/// is SKIPPED — it timed out mid-parse/embed, or failed unrecoverably — that
/// delete+add never ran, so any rows from a PREVIOUS index are still present and
/// may now be stale (the file changed and we couldn't read the new version).
/// Retrieval could then cite an OLD version of the file as current. Because a
/// stale citation is worse than a missing one, we drop the file's rows on any
/// skip.
///
/// BLOCKER 1 FIX: a failed cleanup delete is no longer silently swallowed. The
/// caller receives `PurgeFailed` and counts the file as an additional failure so
/// the UI can report "N files could not be cleaned up" instead of a silent Done.
/// The walk continues (one un-deletable file must not abort it), but the index
/// state for that file is marked unsafe.
pub(crate) async fn purge_stale_rows_on_skip(
    table: &lancedb::Table,
    file_path: &Path,
    key: &[u8; 32],
    outcome: &FileIndexOutcome,
) -> PurgeOutcome {
    match outcome {
        FileIndexOutcome::Indexed => PurgeOutcome::NotNeeded,
        FileIndexOutcome::Failed(_) | FileIndexOutcome::TimedOut => {
            let path_str = file_path.to_string_lossy();
            match store::delete_path(table, &path_str, key).await {
                Ok(()) => {
                    log::info!(
                        "rag_index_workspace: purged stale rows for skipped file {}",
                        file_path.display()
                    );
                    PurgeOutcome::PurgedCleanly
                }
                Err(e) => {
                    log::warn!(
                        "rag_index_workspace: UNSAFE — failed to purge stale rows for skipped \
                         file {} (a stale citation may remain; marking as unsafe): {e:#}",
                        file_path.display()
                    );
                    PurgeOutcome::PurgeFailed
                }
            }
        }
    }
}

/// BUG-099 durable tombstone — record `path`'s HMAC token as unsafe (in the
/// in-memory set AND on disk) so retrieval and verification exclude its stale
/// rows even after an app restart. The token is computed from the plaintext
/// `path` + the vector master `key` (the exact value stored in the `path`
/// column), so the durable file holds NO plaintext path (VG-6e parity).
///
/// Returns `Ok(())` only when the durable write SUCCEEDED. On a disk-write
/// failure it returns `Err`: the in-memory exclusion still applies this session,
/// but the caller must treat the durable fail-closed guarantee as NOT met and
/// avoid stamping the index complete (so the next launch re-runs the walk).
///
/// CONCURRENCY: the disk write happens WHILE the set lock is held, so a
/// concurrent tombstone/clear cannot interleave and persist a stale snapshot.
pub(crate) async fn tombstone_path(
    state: &RagState,
    workspace: &Path,
    path: &str,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    tombstone_token(state, workspace, crypto::path_token(key, path)).await
}

/// P1.1 — tombstone a path by its already-computed HMAC token. The boot reconcile
/// purges a DELETED file knowing only its manifest key (the token, since the
/// plaintext path is gone), so it tombstones by token directly on a purge failure.
/// Same durable/fail-closed semantics as `tombstone_path`.
pub(crate) async fn tombstone_token(
    state: &RagState,
    workspace: &Path,
    token: String,
) -> anyhow::Result<()> {
    use anyhow::Context;
    let mut guard = state.unsafe_tokens.lock().await;
    guard.insert(token);
    let result = store::write_unsafe_tokens(workspace, &guard)
        .context("persist unsafe-tokens tombstone (by token)");
    if result.is_err() {
        // Cross-process fail-closed: the durable token set is now stale/missing
        // this token, and the MCP sidecar only reads disk. Drop a durable sentinel
        // so the sidecar (and a restarted GUI) fail closed until a clean re-index.
        // Also set the in-process flag for the current GUI session.
        store::mark_integrity_unknown(workspace);
        state.index_integrity_unknown.store(true, Ordering::SeqCst);
    }
    result
}

/// BUG-099 durable tombstone — clear `path`'s token from the unsafe set (in
/// memory and on disk) after a clean re-index. No-op (and no disk write) when
/// the token was not tombstoned, so the happy path never touches the file.
///
/// A failed clear-persist is logged but not fatal: leaving a stale tombstone
/// only OVER-suppresses one already-safe file (fail-closed, never fail-open),
/// and the next clean re-index retries the clear.
///
/// CONCURRENCY: as with `tombstone_path`, the disk write is performed under the
/// set lock so memory and disk update atomically w.r.t. other tombstone/clear.
pub(crate) async fn clear_tombstone(state: &RagState, workspace: &Path, path: &str, key: &[u8; 32]) {
    clear_tombstone_token(state, workspace, &crypto::path_token(key, path)).await;
}

/// P1.1 — clear a tombstone by its already-computed HMAC token (the reconcile's
/// deleted-file purge holds the token, not the plaintext path). No-op when the
/// token was not tombstoned, so the happy path never touches the file.
pub(crate) async fn clear_tombstone_token(state: &RagState, workspace: &Path, token: &str) {
    let mut guard = state.unsafe_tokens.lock().await;
    if !guard.remove(token) {
        return; // not tombstoned — nothing to persist.
    }
    if let Err(e) = store::write_unsafe_tokens(workspace, &guard) {
        log::error!("rag: failed to persist cleared tombstone (by token): {e:#}");
    }
}

/// Helper: load the active workspace root, returning a friendly error if
/// the user hasn't opened one.
pub(crate) async fn require_workspace(state: &RagState) -> Result<PathBuf, String> {
    state
        .workspace_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "no active workspace — call rag_set_workspace first".to_string())
}

/// P2.1 (Finding 4) — return the cached open `chunks` table for `workspace`,
/// opening and caching it on a miss. `Ok(None)` means no table exists yet (first
/// launch, before any indexing) — read callers return an empty result for that.
///
/// A cache hit is a cheap `Table` clone (Arc bump); a miss opens the connection
/// and table once and stores the handle. Correctness relies on
/// `store::open_connection`'s zero read-consistency interval so the cached handle
/// always reads the latest committed version (see `RagState::table_cache`). A
/// path mismatch (real workspace switch) transparently re-opens.
pub(crate) async fn cached_chunks_table(
    state: &RagState,
    workspace: &Path,
) -> Result<Option<lancedb::Table>, String> {
    use std::sync::atomic::Ordering as AtomicOrdering;
    // Fast path: a hit for the SAME workspace.
    {
        let guard = state.table_cache.lock().await;
        if let Some(c) = guard.as_ref() {
            if c.workspace == workspace {
                return Ok(Some(c.table.clone()));
            }
        }
    }
    // Miss (empty, or cached for a different workspace): open once and cache.
    // Capture the cache generation BEFORE opening. If a destructive rebuild
    // (`invalidate_table_cache`) bumps it while we open, we must NOT cache the
    // handle we opened — it may point at the dataset being purged.
    let gen_at_open = state.table_cache_gen.load(AtomicOrdering::SeqCst);
    let conn = store::open_connection(workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        // No table yet — drop any handle cached for a prior workspace so a later
        // hit can't return a foreign table (only if no rebuild raced us), and
        // report "nothing to search".
        let mut guard = state.table_cache.lock().await;
        if state.table_cache_gen.load(AtomicOrdering::SeqCst) == gen_at_open {
            *guard = None;
        }
        return Ok(None);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    {
        let mut guard = state.table_cache.lock().await;
        // Only publish if no invalidation (workspace switch / destructive rebuild)
        // raced our open. If the generation moved, a rebuild happened while we were
        // opening: discard rather than cache a possibly-stale handle. The next read
        // re-opens the fresh table. We still return `table` for THIS call (the best
        // snapshot we could get); only the durable CACHE is protected.
        if state.table_cache_gen.load(AtomicOrdering::SeqCst) == gen_at_open {
            *guard = Some(CachedTable {
                workspace: workspace.to_path_buf(),
                table: table.clone(),
            });
        }
    }
    Ok(Some(table))
}

/// P2.1 (Finding 4) — drop the cached table handle AND bump the generation.
/// Called on a workspace switch and around a destructive `drop_table` rebuild (the
/// one operation the read-consistency re-check cannot recover from). The
/// generation bump is what makes a concurrent cache-miss that opened the OLD table
/// discard its handle instead of caching it after this ran (see
/// `cached_chunks_table`). Cheap and always safe: the next read re-opens.
pub(crate) async fn invalidate_table_cache(state: &RagState) {
    state
        .table_cache_gen
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    *state.table_cache.lock().await = None;
}

/// P2.1 (Finding 3) — rebuild the BM25 keyword index in the BACKGROUND and swap
/// it into shared state when done. The expensive full-corpus scan + decrypt runs
/// WITHOUT holding the `bm25` mutex, so in-flight and subsequent hybrid queries
/// are never blocked on it (they fall back to vector-only until this finishes).
///
/// `bm25_warming` coalesces triggers so only one rebuild runs at a time. It is
/// reset when the task exits (including on error / early return) via an RAII
/// guard so a failed rebuild can never wedge the flag "on". The finished index is
/// tagged with the table version it was built at; a later query re-checks
/// freshness against the live version and re-warms if the corpus moved again —
/// the same self-healing the query path always had, just off the hot path.
pub(crate) fn spawn_bm25_warm(
    state: &RagState,
    table: lancedb::Table,
    key: [u8; 32],
    tombstoned: Vec<String>,
    dataset_dir: PathBuf,
    version: u64,
    want_for: PathBuf,
) {
    // Coalesce: if a rebuild is already running, this trigger is a no-op.
    if state
        .bm25_warming
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let bm25 = state.bm25.clone();
    let warming = state.bm25_warming.clone();

    // RAII reset so the flag clears on EVERY exit path (Ok, early return, panic).
    struct WarmGuard(Arc<AtomicBool>);
    impl Drop for WarmGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }

    tokio::spawn(async move {
        let _guard = WarmGuard(warming);
        // Heavy scan + decrypt OUTSIDE the bm25 lock.
        match store::read_all_for_keyword_index(&table, &key, &tombstoned).await {
            Ok(entries) => {
                let mut idx = bm25_index::Bm25Index::new();
                idx.rebuild_from(entries, version);
                idx.note_built_for(&want_for);
                if let Err(e) = idx.persist(&dataset_dir, &key) {
                    log::warn!("rag: background bm25 persist failed ({e:#})");
                }
                // Brief lock only to publish. Don't clobber an index that is
                // already fresh for a NEWER version (a concurrent write advanced
                // the table and a later warm rebuilt it while we scanned) — that
                // would be a downgrade; leave the newer one in place.
                let mut guard = bm25.lock().await;
                let newer_present = guard
                    .table_version()
                    .is_some_and(|v| v > version)
                    && guard.built_for() == Some(want_for.as_path());
                if !newer_present {
                    *guard = idx;
                }
            }
            Err(e) => {
                log::warn!("rag: background bm25 rebuild failed ({e:#}); hybrid stays vector-only");
            }
        }
    });
}
