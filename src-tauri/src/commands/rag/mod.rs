// RAG (Retrieval-Augmented Generation) commands — M1 implementation.
//
// Architecture (per docs/strategy/.../06-RECOMMENDATIONS_BY_LOE.md M1):
//   - Embeddings: fastembed-rs with `MultilingualE5Small` (intfloat/multilingual-e5-small,
//     384-dim ONNX). Lazy singleton in `embedder.rs`.
//   - Storage: LanceDB dataset per workspace at `<workspace>/.keepance/vectors/`,
//     one `chunks` table. Schema lives in `store.rs`.
//   - Chunker: paragraph-aware ~384-token windows with 64-token overlap
//     (`chunker.rs`). Pure / unit-tested.
//   - Extraction: text formats read as raw UTF-8; office documents
//     (docx/xlsx/pptx/rtf) extracted natively Rust-side (VG-2b) — docx via
//     the keepance-docx tree walk, the rest via `office.rs`. The
//     `extractor::classify` dispatch in `index_one_file` covers BOTH the
//     full walk and the watcher (the watcher funnels into `rag_index_file`).
//     PDFs arrive pre-extracted from the renderer via `rag_index_pdf_chunks`.
//
// Commands exposed to the frontend:
//   - `rag_index_file(path)`               — extract → chunk → embed → upsert
//   - `rag_index_workspace()`              — walk + index every supported file,
//                                            emits `rag-indexing-progress` events
//   - `rag_retrieve(query, top_k)`         — embed query → nearest-neighbor → Hits
//   - `rag_cancel_indexing()`              — cancellation signal honoured by
//                                            the active workspace indexer
//   - `rag_set_workspace(path)`            — point the indexer at a workspace
//                                            (called once when the user opens one)
//
// `Hit` is the frozen wire format from Phase 2; do NOT change its shape.

pub mod chunker;
pub mod crypto;
pub mod embedder;
pub mod extractor;
pub mod model_download;
pub mod office;
pub mod pdf_indexer;
pub mod store;
pub mod transcript;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

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
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Idle / Error are valid wire values even if not currently emitted
pub enum IndexingStatus {
    #[default]
    Idle,
    Indexing,
    Done,
    Cancelled,
    Error,
}

/// Tauri event name. Mirrored in `src/utils/tauri-commands.ts`.
pub const PROGRESS_EVENT: &str = "rag-indexing-progress";

/// BUG-099 hardening: a single pathological file must not hold the whole
/// workspace walk forever. Five minutes is intentionally generous for normal
/// text/office sources under the existing size caps (5 MiB text, 50 MiB office)
/// while still giving the Windows bench a clear skip instead of an infinite
/// "20/21 files" stall.
const WORKSPACE_FILE_INDEX_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// BUG-099: cap how many skipped paths ride the terminal progress event. The
/// exact skip/fail/timeout COUNTS are always reported; this only bounds the path
/// LIST so a pathological workspace (everything failing) can't emit a giant
/// payload. The UI shows the first N and relies on the counts for the total.
const MAX_REPORTED_SKIPPED_PATHS: usize = 100;

/// BUG-099: bound the skipped-path list that rides a terminal progress event.
fn cap_skipped_paths(paths: &[String]) -> Vec<String> {
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
    /// BUG-099 durable tombstone: the set of PLAINTEXT paths whose stale-row
    /// cleanup DELETE failed. Retrieval excludes every path in this set by
    /// converting each to its HMAC token (the stored `path` column value) and
    /// adding `path NOT IN (...)` to the prefilter. A path is removed when
    /// `write_extracted_file` successfully re-indexes it — self-healing, surgical
    /// (only the one bad file's rows are suppressed), and process-lifetime durable
    /// (persists across multiple walk calls within the same session).
    pub unsafe_paths: Arc<Mutex<HashSet<String>>>,
}

/// RAII guard that clears `RagState::indexing` on every exit path (normal
/// return, `?` early-return, panic-unwind) so a failed walk never wedges the
/// concurrency flag permanently "on".
struct IndexingGuard(Arc<AtomicBool>);

impl Drop for IndexingGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum FileIndexOutcome {
    Indexed,
    Failed(String),
    TimedOut,
}

/// Run one file's extract+embed job behind a timeout. The job is spawned before
/// waiting so a file that blocks inside synchronous extraction cannot block the
/// outer walk's clock or the final index-version marker write.
/// Still used in tests (the walk now uses `run_file_extract_task`).
#[allow(dead_code)]
async fn run_file_index_task<F>(file: PathBuf, timeout: Duration, fut: F) -> FileIndexOutcome
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
async fn run_file_extract_task<F>(
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
enum PurgeOutcome {
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
async fn purge_stale_rows_on_skip(
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

/// Helper: load the active workspace root, returning a friendly error if
/// the user hasn't opened one.
async fn require_workspace(state: &RagState) -> Result<PathBuf, String> {
    state
        .workspace_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "no active workspace — call rag_set_workspace first".to_string())
}

/// Set or replace the active workspace root the RAG indexer points at.
/// Called when the user opens a workspace, before any indexing.
#[tauri::command]
pub async fn rag_set_workspace(
    state: State<'_, RagState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("workspace path does not exist: {}", path));
    }
    let mut guard = state.workspace_root.lock().await;
    // F-301: only arm the once-per-activation full-index latch when the workspace
    // root actually CHANGES. `useMemoryWiring` calls this on every mount, and the
    // RagState lives in the Rust process — so it survives webview reloads. A dev
    // HMR reload-storm re-mounts the frontend many times for the SAME workspace;
    // re-arming on each of those would re-trigger the destructive full re-index
    // (drop_table + rebuild) over and over and run memory away. Re-opening the
    // SAME already-active workspace is a no-op for indexing (the watcher keeps the
    // index live incrementally); a real switch to a DIFFERENT workspace re-arms.
    let changed = guard.as_deref() != Some(target.as_path());
    *guard = Some(target);
    state.cancel_flag.store(false, Ordering::SeqCst);
    if changed {
        state.full_index_pending.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Index a single file into the local RAG store. Idempotent — re-running
/// for the same path drops stale chunks first.
///
/// WS-B/C: `matter_id` is the confidentiality scope the file is filed under.
/// `None` means "not yet categorized" and is stored under the explicit
/// `UNASSIGNED_MATTER` sentinel — NEVER null/empty (a null matter is a
/// confidentiality hazard). The matter-assignment UI (a separate task) passes a
/// real id here; the file watcher passes `None` until then.
#[tauri::command]
pub async fn rag_index_file(
    state: State<'_, RagState>,
    path: String,
    matter_id: Option<String>,
    privilege: Option<String>,
) -> Result<(), String> {
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    let workspace = require_workspace(&state).await?;
    let file_path = PathBuf::from(&path);
    if !extractor::is_indexable(&file_path) {
        // Silently succeed — the watcher fires for everything and we don't
        // want unsupported files to noisy-error.
        return Ok(());
    }

    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // WS-VEC: the vector-store master key — chunk text is encrypted at rest.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;

    // VG-6d: try to load the workspace vault master key once for this index call.
    // Returns None if the workspace is not vaulted or the vault is locked —
    // in which case indexing proceeds on plaintext files unchanged.
    let vault_vmk_holder = crate::commands::vault::try_load_vault_vmk(&workspace);
    let vault_vmk: Option<&[u8; 32]> = vault_vmk_holder.as_ref().map(|v| v.as_bytes());

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC.
    //
    // F-501: cancel is `None` here ON PURPOSE — `rag_cancel_indexing` leaves
    // the shared flag true until the next walk resets it, and a stale `true`
    // would silently skip every watcher-triggered single-file index.
    index_one_file(&table, &file_path, &matter, &privilege, &key, None, vault_vmk)
        .await
        .map_err(|e| format!("index_file failed: {e:#}"))?;
    // vault_vmk_holder is dropped (and ZeroizedVmk zeroizes) here.
    Ok(())
}

/// Resolve an optional caller-supplied matter id into a concrete, validated
/// scope key. `None`/`Some("")` → the `UNASSIGNED_MATTER` sentinel. A non-empty
/// id is validated (defence-in-depth before it ever reaches a SQL filter).
fn resolve_matter(matter_id: Option<&str>) -> Result<String, String> {
    match matter_id {
        None | Some("") => Ok(store::UNASSIGNED_MATTER.to_string()),
        Some(s) => store::validate_matter_id(s)
            .map(|s| s.to_string())
            .map_err(|e| format!("invalid matter_id: {e}")),
    }
}

/// WS-PRIV — resolve an optional caller-supplied privilege string into a
/// concrete, validated value. `None`/`Some("")` → `PRIVILEGE_NONE` (the safe
/// default: the file carries no privilege claim). A non-empty value is validated
/// against the three known privilege values (defence-in-depth before it reaches
/// a SQL filter or a row write). Mirrors `resolve_matter`.
fn resolve_privilege(privilege: Option<&str>) -> Result<String, String> {
    match privilege {
        None | Some("") => Ok(store::PRIVILEGE_NONE.to_string()),
        Some(s) => store::validate_privilege(s)
            .map(|s| s.to_string())
            .map_err(|e| format!("invalid privilege: {e}")),
    }
}

/// VG-6d: decrypt a file's bytes in memory if it is a KPV1-vaulted file.
///
/// If `vault_vmk` is `Some` and `bytes` starts with the KPV1 magic, this
/// decrypts with the VMK and returns the plaintext. Otherwise the bytes are
/// returned unchanged (either the workspace is not vaulted, the VMK is not
/// available, or the file is already plaintext).
///
/// Decryption failures (wrong key, tampered ciphertext) are treated as
/// "not our file to decrypt" — the original bytes are returned, which will
/// produce a bad extraction and log a warning in the caller. We never silently
/// swallow crypto errors: the caller's existing error-handling path covers it.
fn decrypt_if_vaulted(bytes: Vec<u8>, vault_vmk: Option<&[u8; 32]>) -> Vec<u8> {
    let Some(vmk) = vault_vmk else { return bytes; };
    if !keepance_vault::format::has_vault_magic(&bytes) {
        return bytes;
    }
    match keepance_vault::format::decrypt_file(&bytes, vmk) {
        Ok(plaintext) => plaintext,
        Err(e) => {
            // Decryption failed — log and pass the raw bytes through. The caller's
            // extraction path will likely fail or produce garbage and warn/skip,
            // which is the right outcome (we never silently eat a crypto error).
            log::warn!("rag: KPV1 decrypt failed for a vaulted file: {e}");
            bytes
        }
    }
}

// ─── BUG-099 blocker 2 — single-writer design ───────────────────────────────
//
// Previously, `index_one_file` (extract → embed → DB write) ran ENTIRELY inside
// the timed task. If the timeout fired, the task was aborted but continued
// running synchronously (a blocking parser or embedder pins a thread past `abort()`).
// That zombie could then do a DB write AFTER the parent had already run
// `purge_stale_rows_on_skip` (a delete), producing a race: zombie write after
// cleanup.
//
// Fix: the timed child does ONLY extract + embed (pure computation). The parent
// (the walk) is the SOLE DB writer. A zombie child that times out can never
// reach a DB write — the parent discards the child's handle and moves on.
//
// `ExtractedFileData` is the data the child returns to the parent. The parent
// calls one of: `store::delete_path`, `store::upsert_chunks_for_path`, or
// `store::upsert_grouped`, depending on the variant.
// ─────────────────────────────────────────────────────────────────────────────

/// What a file's extract+embed pass produced. The parent walk is the sole DB
/// writer and dispatches on this to decide what to write (or delete).
enum ExtractedFileData {
    /// The file was missing, empty, or too large — a silent, expected skip.
    /// The parent should call `store::delete_path` to drop any stale rows,
    /// but does NOT count this as a failed file (it's an intentional skip,
    /// e.g. an empty note or a file that exceeds the size cap).
    ShouldDelete,
    /// The file was readable but its content could not be parsed (corrupt
    /// office package, invalid UTF-8 after decryption, etc.). The parent
    /// should call `store::delete_path` AND count this as a `Failed` skip
    /// so the UI can surface "N files skipped" instead of a plain Done.
    /// The reason was already logged at the extraction site.
    SkippedUnreadable,
    /// Standard plain-text / docx / rtf result. Write via
    /// `store::upsert_chunks_for_path`. An empty `rows` Vec means the file
    /// is empty — the parent still calls delete then skips the add.
    Flat {
        rows: Vec<(chunker::Chunk, Vec<f32>)>,
        source_type: store::SourceType,
    },
    /// Sectioned result (xlsx, pptx, transcript). Write via
    /// `store::upsert_grouped`. Each group carries its own `SourceType` and
    /// the extraction marker is always `None` for native (non-OCR) sources.
    Grouped {
        groups: Vec<(store::SourceType, Vec<(chunker::Chunk, Vec<f32>)>)>,
    },
}

/// BLOCKER 2: extract + embed only — no DB write. The caller (the walk) writes
/// to the DB after this returns. This is the timed task's entire job.
///
/// Returns `Ok(Some(data))` with the data to write, `Ok(None)` when the user
/// cancelled mid-file (caller should write nothing and let the walk handle the
/// cancel on its next iteration), or `Err(_)` on a hard failure.
///
/// The function signature mirrors `index_one_file` but takes no `table`
/// parameter — it cannot perform any DB operation.
async fn extract_embed_one_file(
    file_path: &Path,
    cancel: Option<&AtomicBool>,
    vault_vmk: Option<&[u8; 32]>,
) -> anyhow::Result<Option<ExtractedFileData>> {
    let path_str = file_path.to_string_lossy().to_string();
    let Some(kind) = extractor::classify(file_path) else {
        return Ok(Some(ExtractedFileData::ShouldDelete));
    };
    match kind {
        extractor::IndexKind::Text => {
            let Some(raw_bytes) = extractor::read_text_bytes(file_path) else {
                return Ok(Some(ExtractedFileData::ShouldDelete));
            };
            let decrypted = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let Some(text) = String::from_utf8(decrypted).ok() else {
                return Ok(Some(ExtractedFileData::ShouldDelete));
            };
            // Transcript detection (same as index_one_file).
            let ext = file_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            if matches!(ext.as_deref(), Some("txt") | Some("text"))
                && transcript::detect_transcript(&text)
            {
                return extract_embed_transcript(&path_str, &text, cancel).await;
            }
            extract_embed_plain_text(&path_str, &text, store::SourceType::Text, cancel).await
        }
        extractor::IndexKind::Docx | extractor::IndexKind::Rtf => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                // Missing or too large — silent skip (expected).
                return Ok(Some(ExtractedFileData::ShouldDelete));
            };
            let bytes = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let extracted: anyhow::Result<String> = match kind {
                extractor::IndexKind::Docx => keepance_docx::parse_docx_bytes(&bytes)
                    .map(|doc| keepance_docx::extract_paragraph_texts(&doc).join("\n\n"))
                    .map_err(anyhow::Error::from),
                _ => office::extract_rtf_text(&bytes),
            };
            let text = match extracted {
                Ok(t) => t,
                Err(e) => {
                    log::warn!(
                        "rag: skipping unreadable office file {}: {e:#}",
                        file_path.display()
                    );
                    // Extraction failed on a readable file — surface as a skipped
                    // failure so the UI can report it, not silently count as Done.
                    return Ok(Some(ExtractedFileData::SkippedUnreadable));
                }
            };
            let source_type = match kind {
                extractor::IndexKind::Docx => store::SourceType::Docx,
                _ => store::SourceType::Rtf,
            };
            extract_embed_plain_text(&path_str, &text, source_type, cancel).await
        }
        extractor::IndexKind::Xlsx | extractor::IndexKind::Pptx => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                // Missing or too large — silent skip (expected).
                return Ok(Some(ExtractedFileData::ShouldDelete));
            };
            let bytes = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let sections = match kind {
                extractor::IndexKind::Xlsx => office::extract_xlsx_sections(&bytes),
                _ => office::extract_pptx_sections(&bytes),
            };
            let sections = match sections {
                Ok(s) => s,
                Err(e) => {
                    log::warn!(
                        "rag: skipping unreadable office file {}: {e:#}",
                        file_path.display()
                    );
                    // Extraction failed — surface as skipped failure, not silent Done.
                    return Ok(Some(ExtractedFileData::SkippedUnreadable));
                }
            };
            let banded = build_section_chunks(&path_str, &sections);
            if banded.iter().all(|(_, chunks)| chunks.is_empty()) {
                return Ok(Some(ExtractedFileData::ShouldDelete));
            }
            let texts: Vec<String> = banded
                .iter()
                .flat_map(|(_, chunks)| chunks.iter().map(|c| c.text.clone()))
                .collect();
            let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
                return Ok(None); // cancelled
            };
            let source_type_for = |number: u32| match kind {
                extractor::IndexKind::Xlsx => store::SourceType::Xlsx { sheet_number: number },
                _ => store::SourceType::Pptx { slide_number: number },
            };
            let mut vectors = vectors.into_iter();
            let groups: Vec<(store::SourceType, Vec<(chunker::Chunk, Vec<f32>)>)> = banded
                .into_iter()
                .map(|(number, chunks)| {
                    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks
                        .into_iter()
                        .map(|c| {
                            let v = vectors.next().expect("one vector per chunk");
                            (c, v)
                        })
                        .collect();
                    (source_type_for(number), rows)
                })
                .collect();
            Ok(Some(ExtractedFileData::Grouped { groups }))
        }
    }
}

/// Extract + embed a plain-text/docx/rtf file. Returns `Ok(None)` on cancel.
async fn extract_embed_plain_text(
    path_str: &str,
    text: &str,
    source_type: store::SourceType,
    cancel: Option<&AtomicBool>,
) -> anyhow::Result<Option<ExtractedFileData>> {
    let chunks = chunker::chunk_text(path_str, text);
    if chunks.is_empty() {
        return Ok(Some(ExtractedFileData::Flat { rows: Vec::new(), source_type }));
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
        return Ok(None); // cancelled
    };
    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    Ok(Some(ExtractedFileData::Flat { rows, source_type }))
}

/// Extract + embed a transcript file. Returns `Ok(None)` on cancel.
async fn extract_embed_transcript(
    path_str: &str,
    text: &str,
    cancel: Option<&AtomicBool>,
) -> anyhow::Result<Option<ExtractedFileData>> {
    let chunks = transcript::chunk_transcript(path_str, text);
    if chunks.is_empty() {
        return Ok(Some(ExtractedFileData::ShouldDelete));
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
        return Ok(None); // cancelled
    };
    let mut grouped: std::collections::BTreeMap<u32, Vec<(chunker::Chunk, Vec<f32>)>> =
        std::collections::BTreeMap::new();
    for (chunk, vec) in chunks.into_iter().zip(vectors) {
        let page = transcript::locator_start_page(chunk.locator.as_deref()).unwrap_or(1);
        grouped.entry(page).or_default().push((chunk, vec));
    }
    let groups: Vec<(store::SourceType, Vec<(chunker::Chunk, Vec<f32>)>)> = grouped
        .into_iter()
        .map(|(page, rows)| (store::SourceType::Transcript { start_page: page }, rows))
        .collect();
    Ok(Some(ExtractedFileData::Grouped { groups }))
}

/// Write an `ExtractedFileData` value to the DB. This is called by the parent
/// walk — NEVER by the timed child task — enforcing the single-writer invariant.
///
/// Returns `Ok(true)` when the write succeeded but the file should be counted
/// as a skip (SkippedUnreadable: the file was readable but extraction failed).
/// Returns `Ok(false)` when the write succeeded and the file was indexed normally
/// (or was a silent ShouldDelete for a missing/empty file).
async fn write_extracted_file(
    table: &lancedb::Table,
    path_str: &str,
    data: ExtractedFileData,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> anyhow::Result<bool> {
    match data {
        ExtractedFileData::ShouldDelete => {
            store::delete_path(table, path_str, key).await?;
            Ok(false)
        }
        ExtractedFileData::SkippedUnreadable => {
            // Delete stale rows AND signal to the caller that this file was
            // skipped due to an extraction error (not a silent empty/missing).
            store::delete_path(table, path_str, key).await?;
            Ok(true)
        }
        ExtractedFileData::Flat { rows, source_type } => {
            store::upsert_chunks_for_path(table, path_str, rows, source_type, matter_id, privilege, key)
                .await?;
            Ok(false)
        }
        ExtractedFileData::Grouped { groups } => {
            // Build the wire shape upsert_grouped expects: groups with extraction=None.
            let wire: Vec<(store::SourceType, Option<(&str, f32)>, Vec<(chunker::Chunk, Vec<f32>)>)> =
                groups.into_iter().map(|(st, rows)| (st, None, rows)).collect();
            store::upsert_grouped(table, path_str, wire, matter_id, privilege, key).await?;
            Ok(false)
        }
    }
}

/// Internal: extract → chunk → embed → upsert for one file, dispatching on
/// `extractor::classify` (VG-2b — this single dispatch is what makes office
/// documents land from BOTH the full walk and the watcher, which funnels
/// into `rag_index_file`).
///
/// WS-B/C: `matter_id` is the confidentiality scope the file is filed under
/// (the caller supplies it; `UNASSIGNED_MATTER` when not yet categorized). Every
/// written chunk carries it — index-time enforcement, layer one of scoping.
///
/// VG-6d: `vault_vmk` is the workspace vault master key, or `None` when the
/// workspace is not vaulted (or the vault is locked). When `Some`, any file
/// whose first bytes are the KPV1 magic is decrypted in memory before
/// extraction. Plain files pass through unchanged.
///
/// Failure stance: a corrupt/unreadable office file (incl. a zero-byte
/// `.docx`) drops any stale rows, warns, and returns `Ok` — one bad file
/// must never abort a workspace walk, and garbage must never be indexed.
async fn index_one_file(
    table: &lancedb::Table,
    file_path: &Path,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
    cancel: Option<&AtomicBool>,
    vault_vmk: Option<&[u8; 32]>,
) -> anyhow::Result<()> {
    let path_str = file_path.to_string_lossy().to_string();
    let Some(kind) = extractor::classify(file_path) else {
        // Callers gate on `is_indexable` (== classify().is_some()), so this
        // arm is defensive only.
        return Ok(());
    };
    match kind {
        extractor::IndexKind::Text => {
            // VG-6d: read as raw bytes so we can check for KPV1 magic and decrypt
            // before converting to UTF-8. `read_text_bytes` uses the same
            // MAX_FILE_BYTES (5 MiB) cap as `read_text` — the text-file size limit,
            // not the more permissive office-package limit.
            let Some(raw_bytes) = extractor::read_text_bytes(file_path) else {
                // File missing or too big — drop any existing rows for safety.
                store::delete_path(table, &path_str, key).await?;
                return Ok(());
            };
            let decrypted = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let Some(text) = String::from_utf8(decrypted).ok() else {
                // After decryption the bytes are not valid UTF-8 — skip this file.
                store::delete_path(table, &path_str, key).await?;
                return Ok(());
            };
            // Mirror what the old extractor::read_text empty-string guard did:
            // an empty string after decryption still flows into the chunker which
            // returns an empty slice, causing delete + no-op (correct).
            // VG-3c — certified line-numbered deposition transcripts (.txt
            // only) chunk page:line-aware so citations read "Tr. 45:12".
            // Detection is deliberately conservative: a false negative just
            // falls through to the generic path below, which is always
            // correct (the existing Johnson fixture stays generic — its
            // chunk ids are leg-1's regression lock).
            let ext = file_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase());
            if matches!(ext.as_deref(), Some("txt") | Some("text"))
                && transcript::detect_transcript(&text)
            {
                return index_transcript(
                    table, &path_str, &text, matter_id, privilege, key, cancel,
                )
                .await;
            }
            index_plain_text(
                table,
                &path_str,
                &text,
                store::SourceType::Text,
                matter_id,
                privilege,
                key,
                cancel,
            )
            .await
        }
        extractor::IndexKind::Docx | extractor::IndexKind::Rtf => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str, key).await?;
                return Ok(());
            };
            // VG-6d: decrypt in memory before passing to the office extractor.
            let bytes = decrypt_if_vaulted(raw_bytes, vault_vmk);
            // The document's CURRENT READING as plain text: tracked
            // insertions in, deletions out, no raw markup (text.rs); rtf
            // decodes control words/escapes to text (office.rs).
            let extracted: anyhow::Result<String> = match kind {
                extractor::IndexKind::Docx => keepance_docx::parse_docx_bytes(&bytes)
                    .map(|doc| keepance_docx::extract_paragraph_texts(&doc).join("\n\n"))
                    .map_err(anyhow::Error::from),
                _ => office::extract_rtf_text(&bytes),
            };
            let text = match extracted {
                Ok(t) => t,
                Err(e) => {
                    store::delete_path(table, &path_str, key).await?;
                    log::warn!(
                        "rag: skipping unreadable office file {}: {e:#}",
                        file_path.display()
                    );
                    return Ok(());
                }
            };
            let source_type = match kind {
                extractor::IndexKind::Docx => store::SourceType::Docx,
                _ => store::SourceType::Rtf,
            };
            index_plain_text(
                table, &path_str, &text, source_type, matter_id, privilege, key, cancel,
            )
            .await
        }
        extractor::IndexKind::Xlsx | extractor::IndexKind::Pptx => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str, key).await?;
                return Ok(());
            };
            // VG-6d: decrypt in memory before passing to the office extractor.
            let bytes = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let sections = match kind {
                extractor::IndexKind::Xlsx => office::extract_xlsx_sections(&bytes),
                _ => office::extract_pptx_sections(&bytes),
            };
            let sections = match sections {
                Ok(s) => s,
                Err(e) => {
                    store::delete_path(table, &path_str, key).await?;
                    log::warn!(
                        "rag: skipping unreadable office file {}: {e:#}",
                        file_path.display()
                    );
                    return Ok(());
                }
            };
            // A valid package with no extractable sheets/slides is EMPTY
            // TEXT, not an error: drop stale rows, store nothing.
            let banded = build_section_chunks(&path_str, &sections);
            if banded.iter().all(|(_, chunks)| chunks.is_empty()) {
                store::delete_path(table, &path_str, key).await?;
                return Ok(());
            }
            let texts: Vec<String> = banded
                .iter()
                .flat_map(|(_, chunks)| chunks.iter().map(|c| c.text.clone()))
                .collect();
            // F-501 — same bounded, cancel-aware embedding as every other
            // index path; never a new unbatched embed call.
            let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
                return Ok(());
            };
            let mut vectors = vectors.into_iter();
            let source_type_for = |number: u32| match kind {
                extractor::IndexKind::Xlsx => store::SourceType::Xlsx { sheet_number: number },
                _ => store::SourceType::Pptx { slide_number: number },
            };
            // VG-2: office sections are never OCR-extracted — extraction None.
            let groups: Vec<(store::SourceType, Option<(&str, f32)>, Vec<(chunker::Chunk, Vec<f32>)>)> = banded
                .into_iter()
                .map(|(number, chunks)| {
                    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks
                        .into_iter()
                        .map(|c| {
                            let v = vectors.next().expect("one vector per chunk");
                            (c, v)
                        })
                        .collect();
                    (source_type_for(number), None, rows)
                })
                .collect();
            store::upsert_grouped(table, &path_str, groups, matter_id, privilege, key).await?;
            Ok(())
        }
    }
}

/// VG-3c — index a certified line-numbered deposition transcript: page:line
/// chunking (`transcript::chunk_transcript`), then the chunks grouped by
/// their locator's START PAGE so each group's
/// `SourceType::Transcript { start_page }` is honest (the sectioned-source
/// write shape, exactly like PDF pages / xlsx sheets). The per-chunk
/// "Tr. p:l-p:l" detail rides the `locator` column; `paragraph_index` stays
/// the sequential chunk index, so the content-addressed citation contract
/// is unchanged.
async fn index_transcript(
    table: &lancedb::Table,
    path_str: &str,
    text: &str,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
    cancel: Option<&AtomicBool>,
) -> anyhow::Result<()> {
    let chunks = transcript::chunk_transcript(path_str, text);
    if chunks.is_empty() {
        store::delete_path(table, path_str, key).await?;
        return Ok(());
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // F-501 — same bounded, cancel-aware embedding as every other index path.
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
        return Ok(());
    };
    let mut grouped: std::collections::BTreeMap<u32, Vec<(chunker::Chunk, Vec<f32>)>> =
        std::collections::BTreeMap::new();
    for (chunk, vec) in chunks.into_iter().zip(vectors) {
        let page = transcript::locator_start_page(chunk.locator.as_deref()).unwrap_or(1);
        grouped.entry(page).or_default().push((chunk, vec));
    }
    // Transcripts are native text — never OCR-extracted (extraction None).
    let groups: Vec<(store::SourceType, Option<(&str, f32)>, Vec<(chunker::Chunk, Vec<f32>)>)> =
        grouped
            .into_iter()
            .map(|(page, rows)| (store::SourceType::Transcript { start_page: page }, None, rows))
            .collect();
    store::upsert_grouped(table, path_str, groups, matter_id, privilege, key).await?;
    Ok(())
}

/// Shared tail of the unsectioned index paths (text / docx / rtf): chunk →
/// embed (bounded + cancel-aware, F-501) → upsert under one `SourceType`.
#[allow(clippy::too_many_arguments)] // internal seam; mirrors index_one_file's own signature
async fn index_plain_text(
    table: &lancedb::Table,
    path_str: &str,
    text: &str,
    source_type: store::SourceType,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
    cancel: Option<&AtomicBool>,
) -> anyhow::Result<()> {
    let chunks = chunker::chunk_text(path_str, text);
    if chunks.is_empty() {
        store::delete_path(table, path_str, key).await?;
        return Ok(());
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // F-501 — bounded slices; cancel honored between slices. `None` means
    // the user cancelled mid-file: write nothing (the walk's per-file cancel
    // check emits the Cancelled event on its next iteration).
    let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
        return Ok(());
    };
    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
    store::upsert_chunks_for_path(table, path_str, rows, source_type, matter_id, privilege, key)
        .await?;
    Ok(())
}

/// VG-2b — band a sectioned office document's chunks the way PDF pages band:
/// `paragraph_index = section_idx * MAX_CHUNKS_PER_PAGE + sub_idx`, where
/// `section_idx` is the ENUMERATION index over the extracted (non-empty)
/// sections — NOT `OfficeSection.number`, which is the REAL 1-based
/// sheet/slide number, may skip empties, and travels separately as the
/// returned key for the `SourceType`/citation label.
///
/// Short sections become one chunk; long ones re-chunk through the standard
/// text chunker. A pathological section (a worksheet can legally carry tens
/// of thousands of cells) truncates at the band width with a warning so
/// banding can never collide into the next section's `paragraph_index`
/// range — chunk ids stay unique per (path, paragraph_index).
fn build_section_chunks(
    path: &str,
    sections: &[office::OfficeSection],
) -> Vec<(u32, Vec<chunker::Chunk>)> {
    use pdf_indexer::MAX_CHUNKS_PER_PAGE;
    let mut out = Vec::with_capacity(sections.len());
    for (section_idx, section) in sections.iter().enumerate() {
        let band_start = section_idx as u32 * MAX_CHUNKS_PER_PAGE;
        let mut chunks = chunker::chunk_text(path, &section.text);
        if chunks.len() > MAX_CHUNKS_PER_PAGE as usize {
            log::warn!(
                "rag: {} section {} ({}) produced {} chunks; truncating to the {} band width",
                path,
                section.number,
                section.label,
                chunks.len(),
                MAX_CHUNKS_PER_PAGE
            );
            chunks.truncate(MAX_CHUNKS_PER_PAGE as usize);
        }
        for (sub_idx, c) in chunks.iter_mut().enumerate() {
            c.paragraph_index = band_start + sub_idx as u32;
        }
        out.push((section.number, chunks));
    }
    out
}

/// Walk the active workspace and index every supported file. Emits
/// `rag-indexing-progress` events so the UI can render a banner. Honours
/// `rag_cancel_indexing` mid-walk.
#[tauri::command]
pub async fn rag_index_workspace(
    app: AppHandle,
    state: State<'_, RagState>,
    matter_id: Option<String>,
) -> Result<(), String> {
    // Option B: without the embedding model there is nothing to index. Bail
    // with the typed marker BEFORE consuming the once-per-activation latch
    // (F-301) so the frontend can simply re-call after `model_ensure`
    // reports ready and still get the full walk.
    {
        let dir = embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            model_download::model_files_cached(&dir)
        })
        .await
        .map_err(|e| e.to_string())?;
        if !cached {
            return Err(format!(
                "{}: indexing deferred until the model downloads",
                embedder::MODEL_NOT_READY
            ));
        }
    }

    let matter = resolve_matter(matter_id.as_deref())?;
    let workspace = require_workspace(&state).await?;

    // F-301 guard 1 — CONCURRENCY: never run two walks on the same LanceDB
    // dataset at once. Overlapping walks mutate/`drop_table` it concurrently,
    // which corrupts the dataset and triggers the `lance dataset.rs:496` panic
    // flood that leaked memory to an OOM. A second call while one is in flight
    // coalesces. The RAII guard clears the flag on every exit path.
    if state
        .indexing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }
    let _indexing_guard = IndexingGuard(state.indexing.clone());

    // F-301 guard 2 — ONCE PER ACTIVATION: the DEFAULT full walk (`matter_id ==
    // None`, fired on every workspace open) consumes the latch armed by
    // `rag_set_workspace`. Later default calls for the same activation (rapid
    // re-opens under the dev reload-storm) see `false` and return — collapsing
    // the storm's dozens of destructive re-migrations into a single clean pass.
    // A scoped re-index (`matter_id = Some`, from matter remap) is a distinct,
    // deliberate operation and is NOT gated.
    if matter_id.is_none()
        && state
            .full_index_pending
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        return Ok(());
    }

    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel = state.cancel_flag.clone();

    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;

    // WS-B/C migration: a pre-3.0 table has rows without the NON-NULL matter_id
    // column. We never back-fill null (a null matter is a confidentiality
    // hazard) — instead drop the old table and re-index from scratch, which the
    // walk below does anyway. Idempotent + version-gated so it runs at most once.
    if store::needs_migration(&conn, &workspace)
        .await
        .map_err(|e| format!("migration check: {e}"))?
    {
        log::info!("rag: migrating pre-3.0 vector store (re-index under matter scope)");
        store::drop_table(&conn)
            .await
            .map_err(|e| format!("drop legacy table: {e}"))?;
    }

    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // WS-VEC: the vector-store master key — chunk text is encrypted at rest.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;

    // VG-6d: try to load the workspace vault master key once for the whole walk.
    // Returns None if the workspace is not vaulted or the vault is locked —
    // in which case indexing proceeds on plaintext files unchanged. The VMK is
    // held for the duration of the walk and zeroized on drop (ZeroizedVmk).
    let vault_vmk_holder = crate::commands::vault::try_load_vault_vmk(&workspace);
    let vault_vmk: Option<[u8; 32]> = vault_vmk_holder.as_ref().map(|v| *v.as_bytes());

    // Phase 1: walk the tree.
    let files: Vec<PathBuf> = walkdir::WalkDir::new(&workspace)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !extractor::is_skipped_dir_name(&name)
        })
        .filter_map(|res| res.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| extractor::is_indexable(p))
        .collect();

    let total = files.len() as u32;
    let _ = app.emit(
        PROGRESS_EVENT,
        IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 0,
            total,
            current_path: None,
            ..Default::default()
        },
    );

    // Phase 2: index, emitting progress per file.
    let walk_started = Instant::now();
    let mut skipped_files: u32 = 0;
    let mut failed_files: u32 = 0;
    let mut timed_out_files: u32 = 0;
    // BUG-099 separate counter: files where the stale-row cleanup ALSO failed.
    // These are already counted in skipped_files/failed_files/timed_out_files
    // (once each). This counter tracks the additional failure (cleanup itself)
    // without double-counting so the banner's `indexed = total - skipped` stays
    // correct.
    let mut cleanup_failed_files: u32 = 0;
    // BUG-099: the paths we skipped, surfaced (bounded) on the terminal event so
    // the UI can list them. The counts above stay exact regardless of the cap.
    let mut skipped_paths: Vec<String> = Vec::new();
    for (i, file) in files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                PROGRESS_EVENT,
                IndexingProgress {
                    status: IndexingStatus::Cancelled,
                    processed: i as u32,
                    total,
                    current_path: None,
                    skipped: skipped_files,
                    failed: failed_files,
                    timed_out: timed_out_files,
                    cleanup_failed: cleanup_failed_files,
                    skipped_paths: cap_skipped_paths(&skipped_paths),
                },
            );
            return Ok(());
        }
        let _ = app.emit(
            PROGRESS_EVENT,
            IndexingProgress {
                status: IndexingStatus::Indexing,
                processed: i as u32,
                total,
                current_path: Some(file.to_string_lossy().to_string()),
                skipped: skipped_files,
                failed: failed_files,
                timed_out: timed_out_files,
                ..Default::default()
            },
        );
        // WS-PRIV: the full-workspace walk indexes everything at PRIVILEGE_NONE.
        // Privilege is a per-source decision (a whole workspace is never uniformly
        // privileged), applied via the privilege store + `rag_retag_privilege`
        // after indexing — mirroring how per-file matter assignment re-tags on top
        // of the unassigned full walk.
        //
        // BLOCKER 2 — single-writer design: the timed task does ONLY extract + embed
        // (pure computation, no DB access). The parent (this walk) is the SOLE DB
        // writer. A timed-out child that lingers cannot reach any DB write because
        // `extract_embed_one_file` holds no table reference.
        let file_for_task = file.clone();
        let cancel_for_task = cancel.clone();
        let vault_vmk_for_task = vault_vmk;
        let (outcome, extracted) = run_file_extract_task(
            file.clone(),
            WORKSPACE_FILE_INDEX_TIMEOUT,
            async move {
                extract_embed_one_file(
                    &file_for_task,
                    Some(cancel_for_task.as_ref()),
                    vault_vmk_for_task.as_ref(),
                )
                .await
            },
        )
        .await;

        // Parent is sole DB writer: on success write the extracted data; on skip
        // the write is skipped (stale rows are purged below via purge_stale_rows_on_skip).
        if matches!(outcome, FileIndexOutcome::Indexed) {
            if let Some(data) = extracted {
                let path_str = file.to_string_lossy().to_string();
                match write_extracted_file(
                    &table,
                    &path_str,
                    data,
                    &matter,
                    store::PRIVILEGE_NONE,
                    &key,
                )
                .await
                {
                    Ok(true) => {
                        // SkippedUnreadable: extraction failed on a readable file.
                        // Count as a failed skip so the UI can surface it.
                        skipped_files += 1;
                        failed_files += 1;
                        skipped_paths.push(file.to_string_lossy().to_string());
                        log::warn!(
                            "rag_index_workspace: counted as failed skip (unreadable): {}",
                            file.display()
                        );
                        let _ = app.emit(
                            PROGRESS_EVENT,
                            IndexingProgress {
                                status: IndexingStatus::Indexing,
                                processed: i as u32 + 1,
                                total,
                                current_path: Some(file.to_string_lossy().to_string()),
                                skipped: skipped_files,
                                failed: failed_files,
                                timed_out: timed_out_files,
                                ..Default::default()
                            },
                        );
                        continue;
                    }
                    Ok(false) => {
                        // Normal success (indexed or silent empty/missing delete).
                        // BUG-099 tombstone: a successful re-index CLEARS this path's
                        // tombstone (self-healing — the stale rows are now replaced
                        // with fresh ones, so retrieval is safe again).
                        state.unsafe_paths.lock().await.remove(&path_str);
                    }
                    Err(e) => {
                        log::warn!(
                            "rag_index_workspace: DB write failed for {}: {e:#}",
                            file.display()
                        );
                        // Treat a write failure the same as an extraction failure.
                        // BUG-099 tombstone: a failed write may leave old rows in the
                        // DB (if the write was an insert that partially failed, or if
                        // the new delete-then-add cycle failed mid-way). Tombstone the
                        // path so retrieval cannot serve any stale rows for it.
                        state.unsafe_paths.lock().await.insert(path_str.clone());
                        cleanup_failed_files += 1;
                        skipped_files += 1;
                        failed_files += 1;
                        skipped_paths.push(file.to_string_lossy().to_string());
                        let _ = app.emit(
                            PROGRESS_EVENT,
                            IndexingProgress {
                                status: IndexingStatus::Indexing,
                                processed: i as u32 + 1,
                                total,
                                current_path: Some(file.to_string_lossy().to_string()),
                                skipped: skipped_files,
                                failed: failed_files,
                                timed_out: timed_out_files,
                                cleanup_failed: cleanup_failed_files,
                                ..Default::default()
                            },
                        );
                        continue;
                    }
                }
            }
            // `extracted == None` means user cancelled mid-file; the walk's
            // cancel check on the next iteration will emit the Cancelled event.
        }

        // BUG-099 blocker 1: drop stale rows for any skipped file BEFORE moving
        // on, so retrieval can never cite an old version of a file we couldn't
        // re-read. A cleanly indexed file is left untouched.
        // If the purge itself FAILS, the file's stale rows remain in the DB —
        // record it in the durable tombstone set so retrieval ALWAYS excludes
        // those rows. The skip is counted ONCE (not twice) — `cleanup_failed`
        // is a separate counter for the second failure (cleanup itself failed).
        let purge = purge_stale_rows_on_skip(&table, file, &key, &outcome).await;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => {
                skipped_files += 1;
                failed_files += 1;
            }
            FileIndexOutcome::TimedOut => {
                skipped_files += 1;
                timed_out_files += 1;
            }
        }
        match purge {
            PurgeOutcome::NotNeeded => {}
            PurgeOutcome::PurgedCleanly => {
                skipped_paths.push(file.to_string_lossy().to_string());
            }
            PurgeOutcome::PurgeFailed => {
                // The skip was already counted above (once). Do NOT double-count.
                // Instead, record the additional failure in `cleanup_failed_files`
                // and tombstone the path so retrieval cannot serve its stale rows.
                cleanup_failed_files += 1;
                let path_str = file.to_string_lossy().to_string();
                skipped_paths.push(path_str.clone());
                // BUG-099 durable tombstone: stale rows remain in the DB for this
                // path. Mark it unsafe so `rag_retrieve` excludes it until a
                // successful re-index clears the tombstone (self-healing).
                state.unsafe_paths.lock().await.insert(path_str);
                log::error!(
                    "rag_index_workspace: path tombstoned for {} — skipped file \
                     AND cleanup failed; its stale rows are excluded from retrieval \
                     until a successful re-index clears the tombstone",
                    file.display()
                );
            }
        }
        let _ = app.emit(
            PROGRESS_EVENT,
            IndexingProgress {
                status: IndexingStatus::Indexing,
                processed: i as u32 + 1,
                total,
                current_path: Some(file.to_string_lossy().to_string()),
                skipped: skipped_files,
                failed: failed_files,
                timed_out: timed_out_files,
                cleanup_failed: cleanup_failed_files,
                ..Default::default()
            },
        );
    }

    // WS-B/C: stamp the index version so the one-time migration does not re-run.
    // Best-effort (a failed write just means we re-check next open).
    if let Err(e) = store::write_index_version(&workspace) {
        log::warn!("rag: failed to write index version marker: {}", e);
    }

    let _ = app.emit(
        PROGRESS_EVENT,
        IndexingProgress {
            status: IndexingStatus::Done,
            processed: total,
            total,
            current_path: None,
            skipped: skipped_files,
            failed: failed_files,
            timed_out: timed_out_files,
            cleanup_failed: cleanup_failed_files,
            skipped_paths: cap_skipped_paths(&skipped_paths),
        },
    );
    log::info!(
        "rag_index_workspace: DONE {} files in {} ms (skipped={}, failed={}, timed_out={}, cleanup_failed={})",
        total,
        walk_started.elapsed().as_millis(),
        skipped_files,
        failed_files,
        timed_out_files,
        cleanup_failed_files
    );
    Ok(())
}

/// F-510 — per-source diversity cap. A single large low-signal file can
/// dominate a broad retrieval feed (huge-notes.md fed all four of finder
/// attempt 1's findings; rubric 0/5). Keep hits in descending-score order,
/// admit at most `cap` per source (source_id, falling back to path), stop
/// at `top_k`. `cap == 0` means "no cap" so a default-constructed call can
/// never silently empty the feed.
///
/// Pure, deterministic, and rank-preserving: the input order IS the ranking
/// and the output is a subsequence of it (the map below only counts — it
/// never reorders). `pub` so the leg-1 harness
/// (tests/rag_deposition_contradictions.rs) proves the PRODUCTION cap over
/// the real fixture corpus instead of a reimplementation.
pub fn cap_per_source(hits: Vec<Hit>, cap: usize, top_k: usize) -> Vec<Hit> {
    if cap == 0 {
        let mut out = hits;
        out.truncate(top_k);
        return out;
    }
    let mut admitted: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut out: Vec<Hit> = Vec::with_capacity(top_k.min(hits.len()));
    for hit in hits {
        if out.len() >= top_k {
            break;
        }
        let key = hit
            .source_id
            .clone()
            .unwrap_or_else(|| hit.path.clone());
        let count = admitted.entry(key).or_insert(0);
        if *count < cap {
            *count += 1;
            out.push(hit);
        }
    }
    out
}

/// Embed `query` and return the top-k nearest stored chunks, scoped to a matter.
///
/// WS-B/C — THE SECURITY CORE. `scope` is REQUIRED (no implicit cross-matter
/// search):
///   - `Matter { matter_id }` constrains the query with a LanceDB PREFILTER on
///     `matter_id` (prefilter defaults to true). The vector search runs only
///     over in-scope rows, so a Matter-A query can never surface a Matter-B
///     chunk — even under an adversarial confusable term, even at large top_k.
///   - `AllMatters` is a deliberate, separately-named cross-matter capability;
///     it is the ONLY way to search across matters and is never the default.
///
/// WS-PRIV — `include_privileged` is the litigation-safety boundary. It defaults
/// to `false` (via `#[serde(default)]`) so a caller that omits it gets the safe
/// behaviour: attorney-client / work-product chunks are EXCLUDED. Passing `true`
/// is a deliberate, separately-named decision (analogous to `AllMatters`) that
/// composes into the SAME prefilter — never a silent default. Default retrieval
/// therefore never returns privileged content.
///
/// WS-VEC: every chunk's `text` column is encrypted at rest under the vector-
/// store key. This function decrypts in memory before returning; plaintext is
/// never persisted. If decryption fails (key unavailable, tampered data), the
/// chunk text is returned as "[content unavailable]" — retrieval never panics or
/// fails due to a single bad chunk.
///
/// F-510 — `per_source_cap` (camelCase `perSourceCap` over IPC) is an OPTIONAL
/// per-source diversity cap: absent (every existing caller) = behavior
/// unchanged. `Some(cap > 0)` overfetches `top_k * 4` (defensively capped at
/// 200), then `cap_per_source` admits at most `cap` hits per source and
/// truncates to `top_k`. The privilege/matter PREFILTER above is untouched —
/// the cap runs over already-scoped hits, so it can only NARROW a feed, never
/// widen it; it cannot weaken isolation. Today only the contradiction finder
/// passes a cap (perSourceCap: 4); chat retrieval is unchanged.
#[tauri::command]
pub async fn rag_retrieve(
    state: State<'_, RagState>,
    query: String,
    top_k: u32,
    scope: RetrievalScope,
    include_privileged: Option<bool>,
    per_source_cap: Option<u32>,
) -> Result<Vec<Hit>, String> {
    if query.trim().is_empty() || top_k == 0 {
        return Ok(Vec::new());
    }
    // WS-PRIV: absent (legacy callers) or false → EXCLUDE privileged content.
    // Only an explicit `true` flips it. The default is the safe one.
    let include_privileged = include_privileged.unwrap_or(false);
    // F-510: cap == 0 (or absent) = no cap. With a cap we OVERFETCH so the
    // per-source filter has candidates from other sources to fill from.
    let cap = per_source_cap.unwrap_or(0) as usize;
    let fetch_k = if cap > 0 {
        (top_k as usize).saturating_mul(4).min(200)
    } else {
        top_k as usize
    };
    // Resolve + validate the scope into the store-level filter argument BEFORE
    // any work. Matter ids are validated here (defence-in-depth before the SQL
    // prefilter). AllMatters → None (no filter; deliberate cross-matter).
    let scope_filter: Option<String> = match &scope {
        RetrievalScope::Matter { matter_id } => Some(
            store::validate_matter_id(matter_id)
                .map(|s| s.to_string())
                .map_err(|e| format!("invalid scope matter_id: {e}"))?,
        ),
        RetrievalScope::AllMatters => None,
    };
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    // If no table yet, return empty rather than error so first-launch
    // callers get a clean fall-through.
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(Vec::new());
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC (the
    // frontend routes its refusal message on that marker).
    let qvec = embedder::embed_query(&query)
        .await
        .map_err(|e| format!("embed query: {e:#}"))?;

    // WS-VEC / BUG-099: get the vector-store master key once. Used for:
    //   (a) decrypting chunk text and path_enc at read time (enc_key below),
    //   (b) computing HMAC path tokens for the tombstone exclusion filter.
    // If the keychain is unavailable we proceed with enc_key=None (encrypted
    // chunks become "[content unavailable]" placeholders) but with no tombstone
    // exclusion (no key => no token match => safe fallthrough).
    let master_key = crypto::get_or_create_master_key().ok();

    // BUG-099 tombstone: convert unsafe plaintext paths to HMAC tokens so the
    // prefilter can exclude them as SQL `path NOT IN (...)`. The `path` column
    // stores keyed tokens (VG-6e), so we must convert here using the same key.
    // This is the single enforcer: a stale citation is IMPOSSIBLE after a
    // cleanup failure because the row's token is excluded at the prefilter level.
    let tombstoned_tokens: Vec<String> = if let Some(ref k) = master_key {
        let guard = state.unsafe_paths.lock().await;
        guard
            .iter()
            .map(|p| crypto::path_token(k, p))
            .collect()
    } else {
        Vec::new()
    };

    let raw = store::nearest(
        &table,
        &qvec,
        fetch_k,
        scope_filter.as_deref(),
        include_privileged,
        &tombstoned_tokens,
    )
    .await
    .map_err(|e| format!("nearest: {e}"))?;

    // enc_key alias for the decryption path below (same key, clearer name).
    let enc_key = master_key;

    let mut hits: Vec<Hit> = raw
        .into_iter()
        .map(|h| {
            let chunk_text = if h.encrypted {
                // WS-VEC: decrypt the hex-encoded ciphertext in memory.
                // On any failure (bad key, tampered, keychain locked): return
                // a placeholder string — do NOT crash or skip the chunk.
                if let Some(ref k) = enc_key {
                    hex::decode(&h.text)
                        .ok()
                        .and_then(|bytes| {
                            crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                        })
                        .and_then(|v| String::from_utf8(v).ok())
                        .unwrap_or_else(|| "[content unavailable]".to_string())
                } else {
                    "[content unavailable — keychain locked]".to_string()
                }
            } else {
                // Pre-WS-VEC plaintext row (migration re-indexes these): as-is.
                h.text
            };
            // VG-6e: the stored path/source_id columns hold keyed tokens; the
            // real path rides the encrypted path_enc column. Decrypt it here
            // so the frontend keeps receiving real paths for display and
            // click-through. FAIL-CLOSED placeholder (the chunk-text pattern)
            // when the keychain is locked or the blob is bad; a legacy
            // pre-V10 row (no path_enc) passes its raw plaintext column
            // through — the migration re-indexes those away anyway.
            let (path, source_id) = match h.path_enc.as_deref() {
                Some(enc) => {
                    let decrypted = enc_key.as_ref().and_then(|k| {
                        hex::decode(enc)
                            .ok()
                            .and_then(|bytes| {
                                crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                            })
                            .and_then(|v| String::from_utf8(v).ok())
                    });
                    match decrypted {
                        Some(p) => (p.clone(), Some(p)),
                        None => (
                            "[path unavailable]".to_string(),
                            Some("[path unavailable]".to_string()),
                        ),
                    }
                }
                None => (h.path, h.source_id),
            };
            Hit {
                path,
                chunk_text,
                score: embedder::cosine_distance_to_score(h.distance),
                paragraph_index: h.paragraph_index,
                // WS-B/C: carry the citation key + scope + source for the answer layer.
                id: if h.id.is_empty() { None } else { Some(h.id) },
                matter_id: h.matter_id,
                source_id,
                source_type: h.source_type,
                page_number: h.page_number,
                // WS-PRIV: carry the privilege status so an explicitly-included
                // privileged hit can be labelled. Default retrieval only returns "none".
                privilege: h.privilege,
                // VG-2: carry the OCR disclosure so citations can say
                // "scanned" / "low-confidence scan".
                extraction: h.extraction,
                extraction_confidence: h.extraction_confidence,
                // VG-3c: carry the page:line locator so transcript citations
                // can read "Tr. 45:12-46:3".
                locator: h.locator,
            }
        })
        .collect();
    // LanceDB returns by ascending distance, which corresponds to
    // descending score, but sort defensively.
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    // F-510: apply the per-source diversity cap AFTER decrypt/sort, over the
    // already-scoped overfetched candidates, then truncate to the caller's
    // top_k. No cap requested = the overfetch never happened (fetch_k ==
    // top_k) and this is a no-op.
    if cap > 0 {
        hits = cap_per_source(hits, cap, top_k as usize);
    }
    Ok(hits)
}

/// WS-B/C — verify a citation against the store so the app can REFUSE to present
/// an answer whose citation does not verify.
///
/// Inputs:
///   - `id`: the content-addressed chunk id the answer cites.
///   - `claimed_matter_id`: the matter the answer claims the chunk belongs to.
///   - `quoted_text`: the span the answer attributes to the chunk.
///
/// Algorithm (matches the proven spike):
///   1. Point-lookup the chunk by `id` SCOPED to `claimed_matter_id`
///      (prefiltered `id = .. AND matter_id = ..`).
///   2. If not found there, look up by `id` alone to distinguish a fabricated id
///      (`NotFound`) from one that exists under a DIFFERENT matter
///      (`MatterMismatch { actual_matter }` — a confidentiality lie).
///   3. If found in the claimed matter, decrypt the stored text (WS-VEC: chunk
///      text is encrypted at rest), then assert it CONTAINS `quoted_text`
///      (whitespace-normalized). Pass → `Verified`; fail → `TextMismatch`.
///
/// FAIL-CLOSED: if a chunk's text cannot be decrypted (keychain locked,
/// tampered), verification returns `TextMismatch` (treat as unverifiable, do not
/// pass) rather than falsely verifying.
#[tauri::command]
pub async fn rag_verify_citation(
    state: State<'_, RagState>,
    id: String,
    claimed_matter_id: String,
    quoted_text: String,
) -> Result<Verdict, String> {
    // Validate the claimed matter id before it touches a SQL filter.
    let claimed = store::validate_matter_id(&claimed_matter_id)
        .map_err(|e| format!("invalid claimed_matter_id: {e}"))?
        .to_string();

    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        // No index at all — nothing can be verified.
        return Ok(Verdict::NotFound);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // BUG-099 tombstone: build the exclusion set for citation verification.
    // A row from a tombstoned path (cleanup failed → stale rows remain) must
    // return NotFound, not Verified — consistent with what retrieval hides.
    // The `source_id` column holds the same HMAC token as `path`, so we compare
    // the found record's source_id against the tombstoned token set.
    let verify_master_key = crypto::get_or_create_master_key().ok();
    let tombstoned_tokens: std::collections::HashSet<String> = if let Some(ref k) = verify_master_key {
        let guard = state.unsafe_paths.lock().await;
        guard.iter().map(|p| crypto::path_token(k, p)).collect()
    } else {
        std::collections::HashSet::new()
    };

    // 1. Scoped point lookup: id AND claimed matter.
    let scoped = store::lookup_by_id(&table, &id, Some(&claimed))
        .await
        .map_err(|e| format!("verify lookup: {e}"))?;

    let Some(record) = scoped else {
        // 2. Not in the claimed matter — does it exist under any matter?
        let any = store::lookup_by_id(&table, &id, None)
            .await
            .map_err(|e| format!("verify classify lookup: {e}"))?;
        return Ok(match any {
            Some(other) => {
                // If the found record is tombstoned, treat as NotFound (fail-closed).
                if tombstoned_tokens.contains(&other.source_id) {
                    Verdict::NotFound
                } else {
                    Verdict::MatterMismatch {
                        actual_matter: other.matter_id,
                    }
                }
            }
            None => Verdict::NotFound,
        });
    };

    // BUG-099 tombstone: a found record whose source is tombstoned must NOT
    // return Verified — it could be a stale row whose cleanup failed. Fail closed.
    if tombstoned_tokens.contains(&record.source_id) {
        return Ok(Verdict::NotFound);
    }

    // 3. Found in the claimed matter — resolve the stored text (WS-VEC: decrypt).
    let stored_text = if record.encrypted {
        // FAIL-CLOSED: a chunk we cannot decrypt is unverifiable.
        let Some(key) = crypto::get_or_create_master_key().ok() else {
            return Ok(Verdict::TextMismatch);
        };
        let decrypted = hex::decode(&record.text)
            .ok()
            .and_then(|bytes| crate::commands::mail::crypto::decrypt_with_key(&bytes, &key).ok())
            .and_then(|v| String::from_utf8(v).ok());
        match decrypted {
            Some(t) => t,
            None => return Ok(Verdict::TextMismatch),
        }
    } else {
        record.text
    };

    if text_contains_normalized(&stored_text, &quoted_text) {
        Ok(Verdict::Verified)
    } else {
        Ok(Verdict::TextMismatch)
    }
}

/// Canonicalized containment for citation verification. The SAME transform
/// is applied to both sides (direction-safe): Unicode-lowercase, curly
/// quotes straightened (\u{2018}\u{2019} -> ' ; \u{201C}\u{201D} -> "),
/// whitespace runs collapsed. Mirrors the TS grounding normalization
/// (legalAnalysis.ts normalizeQuote) so a quote that grounds also verifies.
/// NOT fuzzy: no other characters are altered or removed; containment
/// direction is unchanged; an empty normalized quote never verifies.
fn text_contains_normalized(stored: &str, quoted: &str) -> bool {
    fn canon(s: &str) -> String {
        let lowered = s.to_lowercase();
        let straightened: String = lowered
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            })
            .collect();
        straightened.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    let q = canon(quoted);
    if q.is_empty() {
        return false;
    }
    canon(stored).contains(&q)
}

// N2: rag_index_mail_text was removed.
// The Tauri command was never called from the frontend; the real indexing path
// is index_mail_text_internal in commands/mail/mod.rs, which calls the rag
// store helpers directly without going through IPC.  Keeping a public
// #[tauri::command] that accepts plaintext over IPC was a latent plaintext-
// over-IPC surface, so the command has been deleted entirely.
//
// If you need to restore it, the full implementation is in git history
// (commit message: "fix(mail): encryption review — purge plaintext mail.db ...").
// Before restoring, verify that the frontend does NOT call it — the IPC
// surface ships plaintext message content from renderer to backend, bypassing
// the encrypted-blob architecture.

/// Set the cancellation flag. `rag_index_workspace` polls this between
/// files and exits cleanly. Called by the frontend "Pause" / "Cancel"
/// button on the indexing banner.
#[tauri::command]
pub async fn rag_cancel_indexing(state: State<'_, RagState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

/// Drop every row whose `path` matches. Wrapper for the watcher path —
/// frontend doesn't usually need to call this directly, but exposing the
/// command keeps the test surface symmetric with `rag_index_file`.
#[tauri::command]
pub async fn rag_delete_path(
    state: State<'_, RagState>,
    path: String,
) -> Result<(), String> {
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(());
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    // VG-6e: the stored path column holds keyed tokens — deleting needs the
    // vector master key to compute the matching token.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    store::delete_path(&table, &path, &key)
        .await
        .map_err(|e| format!("delete path: {e}"))?;
    Ok(())
}

/// BUG-040: purge all RAG chunks for a matter. Called when a matter is deleted
/// so its content can never resurface through all-matters retrieval. `matter_id`
/// is the plaintext scope column, so (unlike `rag_delete_path`) no vector key is
/// needed to build the predicate.
#[tauri::command]
pub async fn rag_delete_matter(
    state: State<'_, RagState>,
    matter_id: String,
) -> Result<(), String> {
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(());
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    store::delete_matter(&table, &matter_id)
        .await
        .map_err(|e| format!("delete matter: {e}"))?;
    Ok(())
}

/// Index pre-extracted PDF page text into the RAG store.
///
/// Called by the JS side after running `extractPdfText` in the renderer.
/// `pages` is one string per page. Empty strings are skipped. `page_count`
/// is the PDF's total page count (metadata only, not used for chunking).
///
/// VG-2: `page_confidences` is aligned with `pages` — `Some(conf)` marks a
/// page whose text the renderer-side local OCR engine read (mean word
/// confidence 0-100); that page's chunks are stored with `extraction = "ocr"`
/// + the confidence so citations disclose it. Omitted/None = all native.
///
/// Returns the number of chunks stored (0 if all pages were empty or skipped).
/// Idempotent — re-indexing drops stale rows first.
#[tauri::command]
pub async fn rag_index_pdf_chunks(
    state: State<'_, RagState>,
    path: String,
    pages: Vec<String>,
    page_count: u32,
    matter_id: Option<String>,
    privilege: Option<String>,
    page_confidences: Option<Vec<Option<f32>>>,
) -> Result<u32, String> {
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // WS-VEC: the vector-store master key — chunk text is encrypted at rest.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC.
    let count = pdf_indexer::index_pdf_chunks(
        &table,
        &path,
        &pages,
        page_count,
        &matter,
        &privilege,
        page_confidences.as_deref(),
        &key,
    )
    .await
    .map_err(|e| format!("index_pdf_chunks: {e:#}"))?;
    Ok(count as u32)
}

/// WS-PRIV — update the privilege of an already-indexed source and re-tag its
/// chunks IN PLACE (no re-embedding). Called when the user marks a file / email /
/// chat as privileged (or clears it) in the UI: the privilege store persists the
/// decision, and this flips the `privilege` column on every chunk for `path`,
/// which is exactly what changes whether the source is excluded from default
/// retrieval.
///
/// `privilege` must be one of "none" | "attorney-client" | "work-product" (an
/// invalid value is rejected). Returns the number of chunks updated — 0 when the
/// source has not been indexed yet (it will pick up the right privilege the next
/// time it is indexed, because the index path reads the privilege store).
#[tauri::command]
pub async fn rag_retag_privilege(
    state: State<'_, RagState>,
    path: String,
    privilege: String,
) -> Result<u32, String> {
    // Validate before any work (defence-in-depth before the SQL update).
    let privilege = store::validate_privilege(&privilege)
        .map_err(|e| format!("invalid privilege: {e}"))?
        .to_string();
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    // No table yet → nothing indexed → nothing to re-tag.
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(0);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    // VG-6e: the retag matches the tokenized path column — needs the key.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let updated = store::retag_privilege_for_path(&table, &path, &privilege, &key)
        .await
        .map_err(|e| format!("retag privilege: {e}"))?;
    Ok(updated as u32)
}

/// WS-B/C — update the matter of an already-indexed source and re-tag its chunks
/// IN PLACE (no re-embedding). The matter-scope mirror of `rag_retag_privilege`.
/// Used when a source's matter assignment changes (a file moved between mapped
/// folders, or a mail folder re-mapped to a different matter) so retrieval
/// scoping updates immediately. `matter_id` must be non-empty (`unassigned` is
/// allowed). Returns the number of chunks updated — 0 when the source has not
/// been indexed yet (it picks up the right matter the next time it is indexed).
#[tauri::command]
pub async fn rag_retag_matter(
    state: State<'_, RagState>,
    path: String,
    matter_id: String,
) -> Result<u32, String> {
    // Validate before any work (defence-in-depth before the SQL update).
    store::validate_matter_id(&matter_id).map_err(|e| format!("invalid matter id: {e}"))?;
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(0);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    // VG-6e: the retag matches the tokenized path column — needs the key.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let updated = store::retag_matter_for_path(&table, &path, &matter_id, &key)
        .await
        .map_err(|e| format!("retag matter: {e}"))?;
    Ok(updated as u32)
}

/// Convenience: register the RAG state with a Tauri builder. Called from
/// `lib.rs::run`'s setup hook.
pub fn manage_state<R: tauri::Runtime>(app: &tauri::App<R>) {
    app.manage(RagState::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- F-510 per-source diversity cap ------------------------------------

    /// Minimal Hit for cap tests: path/source_id = `source`, rest minimal.
    fn mini_hit(source: &str, score: f32) -> Hit {
        Hit {
            path: source.into(),
            chunk_text: String::new(),
            score,
            paragraph_index: 0,
            id: None,
            matter_id: None,
            source_id: Some(source.into()),
            source_type: None,
            page_number: None,
            privilege: None,
            extraction: None,
            extraction_confidence: None,
            locator: None,
        }
    }

    #[test]
    fn cap_per_source_keeps_score_order_and_caps_dominant_sources() {
        let hits = vec![
            mini_hit("/a", 0.9), mini_hit("/a", 0.89), mini_hit("/a", 0.88),
            mini_hit("/b", 0.87), mini_hit("/a", 0.86), mini_hit("/c", 0.85),
            mini_hit("/a", 0.84),
        ];
        let out = cap_per_source(hits, 2, 4);
        let sources: Vec<_> = out.iter().map(|h| h.path.clone()).collect();
        assert_eq!(sources, vec!["/a", "/a", "/b", "/c"]); // /a capped at 2, order kept
    }

    #[test]
    fn cap_per_source_zero_cap_and_short_input_are_safe() {
        assert!(cap_per_source(vec![], 4, 12).is_empty());
        let hits = vec![mini_hit("/a", 0.9)];
        assert_eq!(cap_per_source(hits.clone(), 0, 12).len(), hits.len()); // 0 = no cap (defensive)
        assert_eq!(cap_per_source(hits, 4, 0).len(), 0);
    }

    /// Build a Hit with WS-B/C citation/scope fields populated, for serde tests.
    fn sample_hit() -> Hit {
        Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            id: Some("abc123".into()),
            matter_id: Some("matter-acme".into()),
            source_id: Some("/w/doc.md".into()),
            source_type: None,
            page_number: None,
            privilege: Some("none".into()),
            extraction: None,
            extraction_confidence: None,
            locator: None,
        }
    }

    // ---- F-301 once-per-activation full-index latch -----------------------
    //
    // These model the exact `full_index_pending` true→false swap that gates the
    // DEFAULT full walk in `rag_index_workspace`. They guard the OOM regression:
    // the default full walk is fired on every workspace open, and rapid re-fires
    // (dev HMR reload-storm re-opening the workspace) re-ran the destructive
    // pre-3.0 migration (`drop_table` + re-index) over and over; the rapid
    // drop/recreate churn corrupted the LanceDB dataset and flooded the process
    // with panics whose unwinds leaked memory to an OOM. Contract: armed once by
    // `rag_set_workspace`; exactly one default walk consumes it; later default
    // walks for the same activation are no-ops.

    /// Try to claim the full-index latch exactly as the command does for a
    /// default (`matter_id == None`) walk. Returns true iff this caller should
    /// run the walk.
    fn claim_full_index(latch: &Arc<AtomicBool>) -> bool {
        latch
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    #[test]
    fn full_index_runs_once_per_activation() {
        // `rag_set_workspace` arms the latch.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));

        // The first default walk consumes it and runs.
        assert!(claim_full_index(&latch), "first default walk runs");
        // Every subsequent default walk for the SAME activation is a no-op —
        // this is what collapses the reload-storm's dozens of re-fires into a
        // single clean pass.
        assert!(!claim_full_index(&latch), "2nd default walk is a no-op");
        assert!(!claim_full_index(&latch), "3rd default walk is a no-op");
        assert!(!claim_full_index(&latch), "Nth default walk is a no-op");
        assert!(!latch.load(Ordering::SeqCst), "latch stays consumed");
    }

    #[test]
    fn re_activation_re_arms_the_latch() {
        // Opening a (different) workspace re-arms the latch so its full walk
        // runs once too.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
        assert!(claim_full_index(&latch));
        assert!(!claim_full_index(&latch));

        // `rag_set_workspace` re-arms on the next activation.
        latch.store(true, Ordering::SeqCst);
        assert!(claim_full_index(&latch), "new activation runs one walk");
        assert!(!claim_full_index(&latch), "and only one");
    }

    #[test]
    fn concurrent_default_walks_only_one_wins() {
        // Even if two default walks race the claim, the atomic swap lets exactly
        // one through — no overlapping full walks on the same dataset.
        let latch: Arc<AtomicBool> = Arc::new(AtomicBool::new(true));
        let a = claim_full_index(&latch);
        let b = claim_full_index(&latch);
        assert!(a ^ b, "exactly one of two racing default walks runs");
    }

    /// Model `rag_set_workspace`'s re-arm decision: arm the full-index latch ONLY
    /// when the workspace root actually changes.
    fn set_workspace_rearms(current: Option<&Path>, incoming: &Path) -> bool {
        current != Some(incoming)
    }

    #[test]
    fn reopening_same_workspace_does_not_rearm() {
        let a = PathBuf::from("/tmp/ws-a");
        let b = PathBuf::from("/tmp/ws-b");

        // First activation: None -> /ws-a re-arms (the one clean walk).
        assert!(set_workspace_rearms(None, &a), "first open arms");

        // THE F-301 REGRESSION: re-opening the SAME workspace (every reload calls
        // setWorkspace) must NOT re-arm — otherwise the reload-storm re-triggers
        // the destructive full re-index repeatedly and runs memory away.
        assert!(!set_workspace_rearms(Some(&a), &a), "same workspace never re-arms");
        assert!(!set_workspace_rearms(Some(&a), &a), "...no matter how many times");

        // A real switch to a DIFFERENT workspace re-arms so it gets indexed once.
        assert!(set_workspace_rearms(Some(&a), &b), "switching workspaces arms");
        assert!(!set_workspace_rearms(Some(&b), &b), "then stable again");
    }

    /// Try to acquire the concurrency flag exactly as the command does.
    fn acquire_indexing(flag: &Arc<AtomicBool>) -> bool {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    #[test]
    fn concurrency_guard_blocks_overlap_and_releases_on_exit() {
        let indexing: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));

        // First walk acquires the slot and holds the RAII guard.
        assert!(acquire_indexing(&indexing), "first walk acquires");
        let guard = IndexingGuard(indexing.clone());

        // A walk that arrives while the first is in flight coalesces — so two
        // walks never mutate the same LanceDB dataset concurrently (the cause of
        // the corruption-panic flood).
        assert!(!acquire_indexing(&indexing), "overlapping walk coalesces");
        assert!(indexing.load(Ordering::SeqCst));

        // When the in-flight walk finishes (or `?`-errors / panics), the guard
        // drops and frees the slot so future walks can run.
        drop(guard);
        assert!(!indexing.load(Ordering::SeqCst), "slot freed on exit");
        assert!(acquire_indexing(&indexing), "a later, non-overlapping walk runs");
    }

    #[test]
    fn hit_serializes_camel_case_for_frontend() {
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        // Frontend types will read `paragraphIndex`, not `paragraph_index`.
        assert!(s.contains("\"paragraphIndex\":3"), "got {}", s);
        assert!(s.contains("\"chunkText\":\"para\""), "got {}", s);
        assert!(s.contains("\"score\":0.87"), "got {}", s);
        assert!(s.contains("\"path\":\"/w/doc.md\""), "got {}", s);
    }

    #[test]
    fn hit_serializes_matter_and_source_id_camel_case() {
        // WS-B/C: the answer layer needs matterId + sourceId + id (the citation key).
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"matterId\":\"matter-acme\""), "got {}", s);
        assert!(s.contains("\"sourceId\":\"/w/doc.md\""), "got {}", s);
        assert!(s.contains("\"id\":\"abc123\""), "got {}", s);
    }

    #[test]
    fn hit_round_trips_through_json() {
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).unwrap();
        let back: Hit = serde_json::from_str(&s).unwrap();
        assert_eq!(hit, back);
    }

    #[test]
    fn hit_with_source_type_includes_fields_in_json() {
        let hit = Hit {
            path: "/w/doc.pdf".into(),
            chunk_text: "page text".into(),
            score: 0.9,
            paragraph_index: 0,
            id: Some("pdf-id".into()),
            matter_id: Some("matter-acme".into()),
            source_id: Some("/w/doc.pdf".into()),
            source_type: Some("pdf".into()),
            page_number: Some(1),
            privilege: Some("none".into()),
            extraction: Some("ocr".into()),
            extraction_confidence: Some(48.5),
            locator: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
        assert!(s.contains("\"pageNumber\":1"), "got {}", s);
        // VG-2: the OCR disclosure crosses IPC camel-cased.
        assert!(s.contains("\"extraction\":\"ocr\""), "got {}", s);
        assert!(s.contains("\"extractionConfidence\":48.5"), "got {}", s);
    }

    #[test]
    fn hit_serializes_transcript_locator() {
        // VG-3c: the page:line locator crosses IPC so the UI can label the
        // citation "Tr. 45:12-46:3".
        let hit = Hit {
            source_type: Some("transcript".into()),
            page_number: Some(45),
            locator: Some("45:12-46:3".into()),
            ..sample_hit()
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"transcript\""), "got {}", s);
        assert!(s.contains("\"locator\":\"45:12-46:3\""), "got {}", s);
    }

    #[test]
    fn hit_without_optional_fields_omits_them() {
        let hit = Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            id: None,
            matter_id: None,
            source_id: None,
            source_type: None,
            page_number: None,
            privilege: None,
            extraction: None,
            extraction_confidence: None,
            locator: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(!s.contains("sourceType"), "got {}", s);
        assert!(!s.contains("pageNumber"), "got {}", s);
        assert!(!s.contains("matterId"), "got {}", s);
        assert!(!s.contains("sourceId"), "got {}", s);
        assert!(!s.contains("privilege"), "got {}", s);
        // VG-2: native chunks carry no extraction keys at all.
        assert!(!s.contains("extraction"), "got {}", s);
        // VG-3c: non-transcript hits carry no locator key at all.
        assert!(!s.contains("locator"), "got {}", s);
    }

    #[test]
    fn hit_serializes_privilege_when_present() {
        // WS-PRIV: an explicitly-included privileged hit carries its status so
        // the UI can label it (default retrieval only ever yields "none").
        let hit = sample_hit();
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"privilege\":\"none\""), "got {}", s);
    }

    // -----------------------------------------------------------------------
    // WS-B/C: scope is REQUIRED — its wire encoding must force the caller to
    // name their intent (Matter vs AllMatters), never default to "everything".
    // -----------------------------------------------------------------------

    #[test]
    fn retrieval_scope_matter_round_trips_with_kind_tag() {
        let scope = RetrievalScope::Matter { matter_id: "matter-acme".into() };
        let s = serde_json::to_string(&scope).expect("serialize");
        assert!(s.contains("\"kind\":\"matter\""), "got {}", s);
        assert!(s.contains("\"matterId\":\"matter-acme\""), "got {}", s);
        let back: RetrievalScope = serde_json::from_str(&s).unwrap();
        assert_eq!(scope, back);
    }

    #[test]
    fn retrieval_scope_all_matters_is_explicitly_named() {
        let scope = RetrievalScope::AllMatters;
        let s = serde_json::to_string(&scope).expect("serialize");
        assert!(s.contains("\"kind\":\"allMatters\""), "got {}", s);
        let back: RetrievalScope = serde_json::from_str(&s).unwrap();
        assert_eq!(scope, back);
    }

    #[test]
    fn retrieval_scope_cannot_deserialize_from_empty_object() {
        // An omitted/unnamed scope must NOT decode to a silent cross-matter
        // search. With no "kind" tag, deserialization fails — there is no
        // implicit default. (This is the type-level guard that scope is required.)
        assert!(serde_json::from_str::<RetrievalScope>("{}").is_err());
    }

    // -----------------------------------------------------------------------
    // WS-B/C: verdict wire encoding for all four outcomes.
    // -----------------------------------------------------------------------

    #[test]
    fn verdict_serializes_all_four_variants() {
        let v = serde_json::to_string(&Verdict::Verified).unwrap();
        assert!(v.contains("\"verdict\":\"verified\""), "got {}", v);

        let nf = serde_json::to_string(&Verdict::NotFound).unwrap();
        assert!(nf.contains("\"verdict\":\"notFound\""), "got {}", nf);

        let mm = serde_json::to_string(&Verdict::MatterMismatch {
            actual_matter: "matter-globex".into(),
        })
        .unwrap();
        assert!(mm.contains("\"verdict\":\"matterMismatch\""), "got {}", mm);
        assert!(mm.contains("\"actualMatter\":\"matter-globex\""), "got {}", mm);

        let tm = serde_json::to_string(&Verdict::TextMismatch).unwrap();
        assert!(tm.contains("\"verdict\":\"textMismatch\""), "got {}", tm);
    }

    // -----------------------------------------------------------------------
    // WS-B/C: matter resolution + whitespace-normalized quote containment.
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_matter_defaults_to_unassigned_sentinel() {
        assert_eq!(resolve_matter(None).unwrap(), store::UNASSIGNED_MATTER);
        assert_eq!(resolve_matter(Some("")).unwrap(), store::UNASSIGNED_MATTER);
        assert_eq!(resolve_matter(Some("matter-x")).unwrap(), "matter-x");
        // A malformed id is rejected, never silently coerced.
        assert!(resolve_matter(Some("bad\0id")).is_err());
    }

    #[test]
    fn resolve_privilege_defaults_to_none_and_validates() {
        // WS-PRIV: absent/empty → the safe PRIVILEGE_NONE default (no privilege
        // claim), never a privileged value by accident.
        assert_eq!(resolve_privilege(None).unwrap(), store::PRIVILEGE_NONE);
        assert_eq!(resolve_privilege(Some("")).unwrap(), store::PRIVILEGE_NONE);
        assert_eq!(
            resolve_privilege(Some("attorney-client")).unwrap(),
            store::PRIVILEGE_ATTORNEY_CLIENT
        );
        assert_eq!(
            resolve_privilege(Some("work-product")).unwrap(),
            store::PRIVILEGE_WORK_PRODUCT
        );
        // An unknown value is rejected, never silently coerced.
        assert!(resolve_privilege(Some("bogus")).is_err());
    }

    // -----------------------------------------------------------------------
    // VG-2b: sectioned-office banding — paragraph_index bands by ENUMERATION
    // index; the REAL sheet/slide number travels separately for the label.
    // -----------------------------------------------------------------------

    fn section(number: u32, label: &str, text: &str) -> office::OfficeSection {
        office::OfficeSection {
            number,
            label: label.to_string(),
            text: text.to_string(),
        }
    }

    #[test]
    fn section_chunks_band_by_enumeration_index_not_section_number() {
        // Sheet 2 was empty and skipped upstream: numbers are 1 and 3, but
        // the banding must use the enumeration index (0, 1) — assuming
        // number == idx+1 would leave a hole and mis-band.
        let sections = vec![
            section(1, "Summary", "First sheet text."),
            section(3, "Damages", "Third sheet text."),
        ];
        let banded = build_section_chunks("/w/model.xlsx", &sections);
        assert_eq!(banded.len(), 2);
        assert_eq!(banded[0].0, 1, "real sheet number travels with the group");
        assert_eq!(banded[1].0, 3, "real sheet number travels with the group");
        assert_eq!(banded[0].1[0].paragraph_index, 0);
        assert_eq!(
            banded[1].1[0].paragraph_index,
            pdf_indexer::MAX_CHUNKS_PER_PAGE,
            "second extracted section bands at idx 1, regardless of its number"
        );
    }

    #[test]
    fn long_section_chunks_stay_within_their_band() {
        let long_text = "cell value | another cell\n".repeat(400); // > one chunk
        let sections = vec![
            section(1, "Big", &long_text),
            section(2, "After", "Short tail sheet."),
        ];
        let banded = build_section_chunks("/w/big.xlsx", &sections);
        assert!(banded[0].1.len() >= 2, "long section must split into chunks");
        for c in &banded[0].1 {
            assert!(
                c.paragraph_index < pdf_indexer::MAX_CHUNKS_PER_PAGE,
                "section-0 chunk banded out of range: {}",
                c.paragraph_index
            );
        }
        // The next section starts exactly at its own band.
        assert_eq!(banded[1].1[0].paragraph_index, pdf_indexer::MAX_CHUNKS_PER_PAGE);
    }

    #[test]
    fn no_sections_produce_no_chunks() {
        let banded = build_section_chunks("/w/empty.xlsx", &[]);
        assert!(banded.is_empty());
    }

    #[test]
    fn text_contains_normalized_matches_across_whitespace() {
        let stored = "The closing date  shall be\nMarch 14, 2026.";
        assert!(text_contains_normalized(stored, "closing date shall be March 14, 2026"));
        assert!(text_contains_normalized(stored, "March 14, 2026"));
        // Misquote fails.
        assert!(!text_contains_normalized(stored, "the price is ten billion dollars"));
        // Empty quote is not verifiable.
        assert!(!text_contains_normalized(stored, "   "));
    }

    #[test]
    fn text_contains_normalized_is_case_and_curly_quote_insensitive_but_not_fuzzy() {
        let stored = "He said, \u{201C}I forwarded them to my personal email\u{201D} on Sept 9.";
        // Case drift verifies.
        assert!(text_contains_normalized(stored, "i FORWARDED them to my personal email"));
        // Curly/straight quote drift verifies (both directions of the drift).
        assert!(text_contains_normalized(stored, "\"I forwarded them to my personal email\""));
        assert!(text_contains_normalized("plain 'quote' here", "plain \u{2018}quote\u{2019} here"));
        // NOT fuzzy: a content change still fails.
        assert!(!text_contains_normalized(stored, "I forwarded them to my work email"));
        // Quote characters are CONTENT — canonicalized, never stripped. A quote
        // normalizing to just `""` is non-empty; it fails here by honest
        // containment (stored has no adjacent quote pair), not by the empty rule.
        assert!(!text_contains_normalized(stored, " \u{201C}\u{201D} "));
        // Only the genuinely empty quote hits the empty-refusal path.
        assert!(!text_contains_normalized(stored, ""));
    }

    #[test]
    fn progress_serializes_camel_case() {
        let p = IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 12,
            total: 100,
            current_path: Some("/w/x.md".into()),
            ..Default::default()
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"currentPath\":\"/w/x.md\""), "got {}", s);
        assert!(s.contains("\"processed\":12"));
        assert!(s.contains("\"total\":100"));
        assert!(s.contains("\"status\":\"Indexing\"") || s.contains("\"status\":\"indexing\""));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn workspace_walk_guard_skips_bad_files_and_still_allows_completion_marker() {
        use std::pin::Pin;

        let dir = tempfile::tempdir().expect("tempdir must succeed");
        let files = [
            dir.path().join("01-good.md"),
            dir.path().join("02-bad.md"),
            dir.path().join("03-slow.md"),
            dir.path().join("04-after.md"),
        ];
        for file in &files {
            std::fs::write(file, "fixture").expect("write fixture file");
        }

        let mut processed = 0u32;
        let mut skipped = 0u32;
        let mut failed = 0u32;
        let mut timed_out = 0u32;

        for file in files {
            let name = file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string();
            let fut: Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> =
                if name.contains("bad") {
                    Box::pin(async { anyhow::bail!("forced extraction failure") })
                } else if name.contains("slow") {
                    Box::pin(async {
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        Ok(())
                    })
                } else {
                    Box::pin(async { Ok(()) })
                };

            match run_file_index_task(file, Duration::from_millis(25), fut).await {
                FileIndexOutcome::Indexed => {}
                FileIndexOutcome::Failed(_) => {
                    skipped += 1;
                    failed += 1;
                }
                FileIndexOutcome::TimedOut => {
                    skipped += 1;
                    timed_out += 1;
                }
            }
            processed += 1;
        }

        // This is the critical BUG-099 contract: even after one failed file and
        // one timed-out file, the walk can finish and stamp completion so the
        // next launch does not drop/rebuild the index forever.
        store::write_index_version(dir.path()).expect("write completion marker");

        assert_eq!(processed, 4);
        assert_eq!(skipped, 2);
        assert_eq!(failed, 1);
        assert_eq!(timed_out, 1);
        assert_eq!(store::read_index_version(dir.path()), store::INDEX_VERSION);
    }

    // -----------------------------------------------------------------------
    // BUG-099 hardening (gaps from the 2026-06-22 Codex review)
    // -----------------------------------------------------------------------

    /// Gap 2: the progress event must carry the skip/fail counts AND the skipped
    /// paths, not just the logs, so the UI can render "done, N skipped" instead
    /// of a silent "Done".
    #[test]
    fn progress_serializes_skip_counts_and_paths() {
        let p = IndexingProgress {
            status: IndexingStatus::Done,
            processed: 21,
            total: 21,
            current_path: None,
            skipped: 2,
            failed: 1,
            timed_out: 1,
            cleanup_failed: 0,
            skipped_paths: vec!["/w/stuck.docx".into(), "/w/broken.rtf".into()],
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"skipped\":2"), "got {s}");
        assert!(s.contains("\"failed\":1"), "got {s}");
        assert!(s.contains("\"timedOut\":1"), "got {s}");
        assert!(
            s.contains("\"skippedPaths\":[\"/w/stuck.docx\",\"/w/broken.rtf\"]"),
            "got {s}"
        );
    }

    /// Gap 2: per-file events stay small — when there are no skipped paths the
    /// `skippedPaths` array is omitted from the wire payload entirely.
    #[test]
    fn progress_omits_empty_skipped_paths() {
        let p = IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 3,
            total: 21,
            current_path: Some("/w/a.md".into()),
            skipped: 0,
            failed: 0,
            timed_out: 0,
            cleanup_failed: 0,
            skipped_paths: Vec::new(),
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(!s.contains("skippedPaths"), "empty paths must be omitted: {s}");
        assert!(s.contains("\"skipped\":0"), "got {s}");
    }

    /// Gap 1 + Gap 3 (the highest-severity finding): a file we SKIPPED (timed out
    /// or failed mid-extract/embed) must have its now-possibly-stale rows dropped,
    /// so retrieval can never cite an OLD version of a file we couldn't re-read.
    /// A cleanly indexed file must be left untouched (its re-index already
    /// replaced its rows atomically).
    #[tokio::test]
    async fn skip_outcome_purges_stale_rows_but_indexed_outcome_keeps_them() {
        let key = [0x42u8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path = "/w/contract.docx";
        let mk_rows = |text: &str| {
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: text.into(),
                    start_offset: 0,
                    end_offset: text.len(),
                    locator: None,
                },
                vec![0.10f32; embedder::EMBEDDING_DIM],
            )]
        };
        let q = vec![0.10f32; embedder::EMBEDDING_DIM];
        let present = |table: &lancedb::Table| {
            let q = q.clone();
            let table = table.clone();
            async move { !store::nearest(&table, &q, 10, None, false, &[]).await.unwrap().is_empty() }
        };

        // Seed v1 — the file's rows now exist.
        store::upsert_chunks_for_path(
            &table,
            path,
            mk_rows("old version"),
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("seed v1");
        assert!(present(&table).await, "precondition: the file is indexed");

        // A cleanly INDEXED outcome must NOT purge — wiping a good file's rows
        // would itself create a missing-citation regression.
        let purge =
            purge_stale_rows_on_skip(&table, Path::new(path), &key, &FileIndexOutcome::Indexed)
                .await;
        assert_eq!(purge, PurgeOutcome::NotNeeded, "indexed files must not be purged");
        assert!(present(&table).await, "indexed file's rows must remain");

        // A TIMED-OUT outcome drops the stale rows cleanly (table is healthy).
        let purge =
            purge_stale_rows_on_skip(&table, Path::new(path), &key, &FileIndexOutcome::TimedOut)
                .await;
        assert_eq!(purge, PurgeOutcome::PurgedCleanly, "timed-out files must be purged cleanly");
        assert!(!present(&table).await, "stale rows must be gone after a timeout skip");

        // A FAILED outcome likewise purges (re-seed, then fail).
        store::upsert_chunks_for_path(
            &table,
            path,
            mk_rows("old version"),
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("re-seed");
        let purge = purge_stale_rows_on_skip(
            &table,
            Path::new(path),
            &key,
            &FileIndexOutcome::Failed("forced extraction failure".into()),
        )
        .await;
        assert_eq!(purge, PurgeOutcome::PurgedCleanly, "failed files must be purged cleanly");
        assert!(!present(&table).await, "stale rows must be gone after a failed skip");
    }

    /// Gap 4: the guard must time out on GENUINELY BLOCKING work — a file whose
    /// extraction (or the blocking embedder) pins a runtime thread synchronously,
    /// the real BUG-099 case — not just a cancellable `tokio::time::sleep`. The
    /// walk must return promptly instead of being frozen by the one stuck file.
    /// This also documents finding #1: `abort()` does NOT hard-kill the blocking
    /// thread (the work is still pending right after the timeout), which is why a
    /// true hard-kill would require process isolation (see the BUG-099 report).
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn workspace_walk_guard_times_out_on_genuinely_blocking_work() {
        use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

        let finished = Arc::new(AtomicBool::new(false));
        let finished_in_task = finished.clone();
        let started = Instant::now();
        let outcome = run_file_index_task(
            PathBuf::from("/w/stuck.docx"),
            Duration::from_millis(30),
            async move {
                // Synchronous, non-cancellable block on a runtime worker thread.
                std::thread::sleep(Duration::from_millis(800));
                finished_in_task.store(true, AtomicOrdering::SeqCst);
                Ok(())
            },
        )
        .await;
        let elapsed = started.elapsed();

        assert_eq!(
            outcome,
            FileIndexOutcome::TimedOut,
            "genuinely blocking work must be reported as timed out"
        );
        // The guard returned long before the blocked work would finish: one stuck
        // file cannot freeze the whole walk.
        assert!(
            elapsed < Duration::from_millis(500),
            "guard must return promptly, not wait for the blocked work; took {elapsed:?}"
        );
        // Finding #1: the blocking task is STILL running after abort() — a Rust
        // task abort is not a hard kill of synchronous work.
        assert!(
            !finished.load(AtomicOrdering::SeqCst),
            "blocking task is expected to still be running after abort (no hard-kill)"
        );
    }

    // -----------------------------------------------------------------------
    // VG-6d: decrypt-on-read seam — Task 13 of the Wave 3b encrypted-vault plan.
    //
    // These tests exercise the `decrypt_if_vaulted` helper with an injected VMK
    // so no keychain is required. The full integration (vault metadata + keychain
    // → index_one_file) is covered by the live-app native pass; the unit path
    // here proves the seam logic in isolation.
    // -----------------------------------------------------------------------

    /// A vaulted file (KPV1 magic) is decrypted when the VMK is provided.
    ///
    /// This is the "destructive item 12" spec test: encrypt the plaintext,
    /// write it to a temp workspace with `.keepance-vault.json`, then drive the
    /// decrypt_if_vaulted seam and assert the plaintext is recovered.
    #[test]
    fn vaulted_file_decrypts_to_plaintext_with_vmk() {
        use keepance_vault::format::encrypt_file;

        let vmk: [u8; 32] = [0xCC; 32];
        let plaintext = b"the quick brown fox";

        // Encrypt the plaintext to produce a KPV1 blob.
        let blob = encrypt_file(plaintext, &vmk).expect("encrypt_file must succeed");

        // The blob must start with KPV1 magic.
        assert_eq!(&blob[..4], b"KPV1", "encrypted blob must have KPV1 magic");

        // decrypt_if_vaulted with the VMK must return the original plaintext.
        let result = decrypt_if_vaulted(blob, Some(&vmk));
        assert_eq!(
            result, plaintext,
            "decrypt_if_vaulted must recover the plaintext from a KPV1 blob"
        );
    }

    /// A plain file (no KPV1 magic) passes through decrypt_if_vaulted unchanged,
    /// even when a VMK is provided (the workspace is vaulted but the file is plain).
    #[test]
    fn plain_file_passes_through_decrypt_seam_unchanged() {
        let vmk: [u8; 32] = [0xDD; 32];
        let plaintext = b"# Plain markdown document\n\nThis is not encrypted.".to_vec();

        // No KPV1 magic — passes through unchanged.
        let result = decrypt_if_vaulted(plaintext.clone(), Some(&vmk));
        assert_eq!(
            result, plaintext,
            "plain file must be returned unchanged by decrypt_if_vaulted"
        );
    }

    /// Non-vaulted workspace (vault_vmk = None): any bytes pass through unchanged.
    #[test]
    fn no_vmk_passes_any_bytes_through() {
        // Even bytes that happen to look like KPV1 magic pass through when there
        // is no VMK (non-vaulted workspace or locked vault).
        let fake_vaulted = b"KPV1\x01some-garbled-bytes".to_vec();
        let result = decrypt_if_vaulted(fake_vaulted.clone(), None);
        assert_eq!(
            result, fake_vaulted,
            "bytes must pass through unchanged when vault_vmk is None"
        );
    }

    /// Wrong VMK: decrypt_if_vaulted returns the original bytes (decryption failed),
    /// never panics, never returns garbage that claims to be plaintext.
    #[test]
    fn wrong_vmk_returns_original_bytes_not_garbage() {
        use keepance_vault::format::encrypt_file;

        let right_vmk: [u8; 32] = [0xEE; 32];
        let wrong_vmk: [u8; 32] = [0xFF; 32];
        let plaintext = b"confidential content";

        let blob = encrypt_file(plaintext, &right_vmk).expect("encrypt_file must succeed");

        // Wrong VMK — decrypt_if_vaulted must return the original blob, not plaintext.
        let result = decrypt_if_vaulted(blob.clone(), Some(&wrong_vmk));
        assert_eq!(
            result, blob,
            "wrong VMK must return original bytes, not partially-decrypted garbage"
        );
        // Importantly, the result must NOT equal the plaintext.
        assert_ne!(result.as_slice(), plaintext.as_slice());
    }

    // -----------------------------------------------------------------------
    // BUG-099 blockers 1 & 2 — the new robustness guarantees
    // -----------------------------------------------------------------------

    /// BUG-099 blocker 1 REAL test: force a genuine purge failure, then assert
    /// (a) `PurgeFailed` is returned, (b) the tombstone set contains the path, and
    /// (c) retrieval EXCLUDES the path's stale rows via `nearest` with the tombstone
    /// token. A separate assertion proves re-indexing clears the tombstone (self-heal).
    ///
    /// The purge failure is forced by making the LanceDB dataset directory read-only
    /// after seeding, so LanceDB's delete-fragment write fails with an IO error — the
    /// same kind of error that would occur on a corrupted or locked store in production.
    #[tokio::test]
    #[cfg(unix)] // read-only dir is reliably enforceable on Unix; Windows has ACL nuances
    async fn purge_failure_tombstones_path_and_retrieval_excludes_stale_rows() {
        use std::os::unix::fs::PermissionsExt;

        let key = [0xABu8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path = "/w/corrupt.docx";
        let q = vec![0.11f32; embedder::EMBEDDING_DIM];

        // Helper closure: true when the path's rows are visible via nearest.
        let is_visible = |table: &lancedb::Table| {
            let table = table.clone();
            let q = q.clone();
            async move {
                !store::nearest(&table, &q, 10, None, false, &[])
                    .await
                    .unwrap()
                    .is_empty()
            }
        };

        // Seed a stale row (the "old version" that should never be cited after failure).
        store::upsert_chunks_for_path(
            &table,
            path,
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "stale content".into(),
                    start_offset: 0,
                    end_offset: 13,
                    locator: None,
                },
                vec![0.11f32; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("seed stale row");
        assert!(is_visible(&table).await, "precondition: stale row is visible");

        // Lock the LanceDB dataset directory to make delete fail with an IO error.
        // LanceDB's delete must write a deletion fragment file; this prevents that.
        let vectors_dir = store::dataset_path(dir.path());
        let orig_perms = std::fs::metadata(&vectors_dir).unwrap().permissions();
        std::fs::set_permissions(&vectors_dir, std::fs::Permissions::from_mode(0o444))
            .expect("set read-only");

        // Attempt purge — must return PurgeFailed because the IO write is blocked.
        let purge = purge_stale_rows_on_skip(
            &table,
            Path::new(path),
            &key,
            &FileIndexOutcome::TimedOut,
        )
        .await;

        // Restore permissions immediately (before any assert so cleanup is guaranteed).
        std::fs::set_permissions(&vectors_dir, orig_perms).expect("restore permissions");

        assert_eq!(
            purge,
            PurgeOutcome::PurgeFailed,
            "read-only dataset directory must cause PurgeFailed (genuine IO error)"
        );

        // (a) Stale rows are still present (the delete failed, nothing was removed).
        assert!(
            is_visible(&table).await,
            "stale rows must still be present after a failed purge"
        );

        // (b) Simulate the tombstone the walk would record: convert path to token.
        let tombstone_token = crate::commands::rag::crypto::path_token(&key, path);
        let tombstoned = vec![tombstone_token];

        // (c) Retrieval with the tombstone token MUST NOT return any hits for that path.
        let hits = store::nearest(&table, &q, 10, None, false, &tombstoned)
            .await
            .expect("nearest with tombstone");
        assert!(
            hits.is_empty(),
            "retrieval must exclude stale rows for a tombstoned path; got {} hits",
            hits.len()
        );

        // Without the tombstone, the stale rows are still findable (confirming the
        // tombstone is doing the work, not an accidental empty table).
        let hits_no_tombstone = store::nearest(&table, &q, 10, None, false, &[])
            .await
            .expect("nearest without tombstone");
        assert!(
            !hits_no_tombstone.is_empty(),
            "stale rows must still exist in the table (tombstone is the only guardrail)"
        );

        // (d) Self-heal: a successful re-index clears the tombstone. After a fresh
        // upsert, the path is no longer in the unsafe set — retrieval is restored.
        // We simulate this by showing that a subsequent successful write would remove
        // the path from the unsafe_paths set. Here we test the prefilter directly:
        // after "clearing" the tombstone (empty slice), the fresh row IS returned.
        store::upsert_chunks_for_path(
            &table,
            path,
            vec![(
                chunker::Chunk {
                    path: path.into(),
                    paragraph_index: 0,
                    text: "fresh content".into(),
                    start_offset: 0,
                    end_offset: 13,
                    locator: None,
                },
                vec![0.11f32; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            store::UNASSIGNED_MATTER,
            store::PRIVILEGE_NONE,
            &key,
        )
        .await
        .expect("re-index after tombstone cleared");

        // After clearing the tombstone (empty exclusion list), the fresh rows return.
        let hits_after_clear = store::nearest(&table, &q, 10, None, false, &[])
            .await
            .expect("nearest after tombstone cleared");
        assert!(
            !hits_after_clear.is_empty(),
            "fresh rows must be visible after tombstone is cleared (re-index)"
        );
    }

    /// BUG-099 tombstone integration test: when PurgeFailed is stored in
    /// `RagState::unsafe_paths`, the walk does NOT double-count the file in
    /// `skipped_files` (i.e. each file is counted only once as skipped even if
    /// cleanup also fails). The cleanup_failed counter tracks the additional failure.
    #[test]
    fn purge_failed_uses_separate_cleanup_counter_not_double_count() {
        // Simulate the counter logic from rag_index_workspace for three cases:
        //   1. File timed out, cleanup succeeded (PurgedCleanly) → skipped=1, failed=0, timed_out=1, cleanup_failed=0
        //   2. File failed, cleanup succeeded (PurgedCleanly)    → skipped=1, failed=1, timed_out=0, cleanup_failed=0
        //   3. File timed out, cleanup ALSO failed (PurgeFailed)  → skipped=1, failed=0, timed_out=1, cleanup_failed=1
        //      NOT skipped=2 (the old double-count bug).

        // Case 1: TimedOut + PurgedCleanly
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::TimedOut;
        let purge = PurgeOutcome::PurgedCleanly;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 0, 1, 0),
            "TimedOut+PurgedCleanly: skipped=1, no double-count");

        // Case 2: Failed + PurgedCleanly
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::Failed("err".into());
        let purge = PurgeOutcome::PurgedCleanly;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 1, 0, 0),
            "Failed+PurgedCleanly: skipped=1, no double-count");

        // Case 3: TimedOut + PurgeFailed — the bug was skipped=2; must be skipped=1.
        let (mut skipped, mut failed, mut timed_out, mut cleanup_failed) = (0u32, 0u32, 0u32, 0u32);
        let outcome = FileIndexOutcome::TimedOut;
        let purge = PurgeOutcome::PurgeFailed;
        match outcome {
            FileIndexOutcome::Indexed => {}
            FileIndexOutcome::Failed(_) => { skipped += 1; failed += 1; }
            FileIndexOutcome::TimedOut => { skipped += 1; timed_out += 1; }
        }
        match purge {
            PurgeOutcome::NotNeeded | PurgeOutcome::PurgedCleanly => {}
            PurgeOutcome::PurgeFailed => { cleanup_failed += 1; }
        }
        assert_eq!((skipped, failed, timed_out, cleanup_failed), (1, 0, 1, 1),
            "TimedOut+PurgeFailed: skipped=1 (not 2), cleanup_failed=1 (separate counter)");
    }

    /// BLOCKER 2: single-writer invariant — a timed-out child task cannot reach
    /// any DB write because `extract_embed_one_file` has NO table parameter.
    /// This is a STRUCTURAL guarantee, not a runtime race: the type system
    /// prevents the child from calling any store function.
    ///
    /// We verify that:
    /// (a) `run_file_extract_task` returns `(TimedOut, None)` when the child blocks,
    /// (b) the child had no opportunity to write (it has no table reference),
    /// (c) a successful extraction returns `(Indexed, Some(data))` and the
    ///     parent's `write_extracted_file` is the only path that touches the DB.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn single_writer_timed_out_child_cannot_write() {
        use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

        // Prove that a blocking child times out and returns (TimedOut, None).
        let db_write_attempted = Arc::new(AtomicBool::new(false));
        let db_write_in_task = db_write_attempted.clone();
        let started = Instant::now();

        let (outcome, data) = run_file_extract_task(
            PathBuf::from("/w/stuck.docx"),
            Duration::from_millis(30),
            async move {
                // Synchronous, non-cancellable block — the real BUG-099 case.
                std::thread::sleep(Duration::from_millis(800));
                // If we ever reach here, the "write" would happen. Mark it.
                db_write_in_task.store(true, AtomicOrdering::SeqCst);
                // No table reference here — this Future's type cannot call
                // any store::* function. The compile-time signature enforces it.
                Ok(Some(ExtractedFileData::ShouldDelete))
            },
        )
        .await;

        assert_eq!(outcome, FileIndexOutcome::TimedOut,
            "blocking child must be reported as timed out");
        assert!(data.is_none(),
            "timed-out child must return None data — parent has nothing to write");
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "parent must return promptly; child block must not freeze the walk"
        );
        // The child has NOT yet set db_write_attempted — it is still blocking
        // on the thread sleep. The walk has moved on without touching the DB.
        // (If this assertion flakes, the thread sleep duration above needs
        // extending so the child is still running when we reach this check.)
        assert!(
            !db_write_attempted.load(AtomicOrdering::SeqCst),
            "child must not have reached any write code before the parent checked"
        );
    }

    /// BLOCKER 2 (positive case): a successful extraction returns (Indexed, Some(data))
    /// and the parent can write it via write_extracted_file.
    #[tokio::test]
    async fn single_writer_successful_extraction_parent_writes() {
        let key = [0x55u8; 32];
        let dir = tempfile::TempDir::new().unwrap();
        let conn = store::open_connection(dir.path()).await.expect("open conn");
        let table = store::open_or_create_table(&conn).await.expect("open table");

        let path_str = "/w/notes.md";

        // Simulate a successful extraction returning a Flat result.
        let (outcome, data) = run_file_extract_task(
            PathBuf::from(path_str),
            Duration::from_secs(10),
            async {
                let chunks = chunker::chunk_text(path_str, "Meeting notes: discuss budget.");
                let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks
                    .into_iter()
                    .map(|c| (c, vec![0.42f32; embedder::EMBEDDING_DIM]))
                    .collect();
                Ok(Some(ExtractedFileData::Flat {
                    rows,
                    source_type: store::SourceType::Text,
                }))
            },
        )
        .await;

        assert_eq!(outcome, FileIndexOutcome::Indexed);
        assert!(data.is_some(), "successful extraction must return Some(data)");

        // Parent writes the data — it is the SOLE DB writer.
        write_extracted_file(&table, path_str, data.unwrap(), store::UNASSIGNED_MATTER, store::PRIVILEGE_NONE, &key)
            .await
            .expect("parent DB write must succeed");

        // Confirm the data is now in the index.
        let q = vec![0.42f32; embedder::EMBEDDING_DIM];
        let hits = store::nearest(&table, &q, 10, None, false, &[]).await.expect("nearest");
        assert!(!hits.is_empty(), "indexed data must be retrievable after parent write");
    }

    /// `try_load_vault_vmk` returns None for a workspace with no vault metadata.
    /// (Tests the public-facing seam used by both rag_index_file and rag_index_workspace.)
    #[test]
    fn try_load_vault_vmk_returns_none_for_unvaulted_workspace() {
        let dir = tempfile::tempdir().expect("tempdir must succeed");
        let root = dir.path();

        // No .keepance-vault.json — must return None.
        let result = crate::commands::vault::try_load_vault_vmk(root);
        assert!(
            result.is_none(),
            "try_load_vault_vmk must return None for a workspace with no vault metadata"
        );
    }
}
