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

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IndexingProgress {
    pub status: IndexingStatus,
    pub processed: u32,
    pub total: u32,
    pub current_path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // Idle / Error are valid wire values even if not currently emitted
pub enum IndexingStatus {
    Idle,
    Indexing,
    Done,
    Cancelled,
    Error,
}

/// Tauri event name. Mirrored in `src/utils/tauri-commands.ts`.
pub const PROGRESS_EVENT: &str = "rag-indexing-progress";

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

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC.
    //
    // F-501: cancel is `None` here ON PURPOSE — `rag_cancel_indexing` leaves
    // the shared flag true until the next walk resets it, and a stale `true`
    // would silently skip every watcher-triggered single-file index.
    index_one_file(&table, &file_path, &matter, &privilege, &key, None)
        .await
        .map_err(|e| format!("index_file failed: {e:#}"))?;
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

/// Internal: extract → chunk → embed → upsert for one file, dispatching on
/// `extractor::classify` (VG-2b — this single dispatch is what makes office
/// documents land from BOTH the full walk and the watcher, which funnels
/// into `rag_index_file`).
///
/// WS-B/C: `matter_id` is the confidentiality scope the file is filed under
/// (the caller supplies it; `UNASSIGNED_MATTER` when not yet categorized). Every
/// written chunk carries it — index-time enforcement, layer one of scoping.
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
) -> anyhow::Result<()> {
    let path_str = file_path.to_string_lossy().to_string();
    let Some(kind) = extractor::classify(file_path) else {
        // Callers gate on `is_indexable` (== classify().is_some()), so this
        // arm is defensive only.
        return Ok(());
    };
    match kind {
        extractor::IndexKind::Text => {
            let Some(text) = extractor::read_text(file_path) else {
                // File missing or too big — drop any existing rows for safety.
                store::delete_path(table, &path_str).await?;
                return Ok(());
            };
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
            let Some(bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str).await?;
                return Ok(());
            };
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
                    store::delete_path(table, &path_str).await?;
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
            let Some(bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str).await?;
                return Ok(());
            };
            let sections = match kind {
                extractor::IndexKind::Xlsx => office::extract_xlsx_sections(&bytes),
                _ => office::extract_pptx_sections(&bytes),
            };
            let sections = match sections {
                Ok(s) => s,
                Err(e) => {
                    store::delete_path(table, &path_str).await?;
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
                store::delete_path(table, &path_str).await?;
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
        store::delete_path(table, path_str).await?;
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
        },
    );

    // Phase 2: index, emitting progress per file.
    for (i, file) in files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                PROGRESS_EVENT,
                IndexingProgress {
                    status: IndexingStatus::Cancelled,
                    processed: i as u32,
                    total,
                    current_path: None,
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
            },
        );
        // WS-PRIV: the full-workspace walk indexes everything at PRIVILEGE_NONE.
        // Privilege is a per-source decision (a whole workspace is never uniformly
        // privileged), applied via the privilege store + `rag_retag_privilege`
        // after indexing — mirroring how per-file matter assignment re-tags on top
        // of the unassigned full walk.
        if let Err(e) = index_one_file(
            &table,
            file,
            &matter,
            store::PRIVILEGE_NONE,
            &key,
            Some(cancel.as_ref()),
        )
        .await
        {
            // Don't abort the whole walk on a single bad file — log and move on.
            log::warn!(
                "rag_index_workspace: failed to index {}: {}",
                file.display(),
                e
            );
        }
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
        },
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

    let raw = store::nearest(
        &table,
        &qvec,
        fetch_k,
        scope_filter.as_deref(),
        include_privileged,
    )
    .await
    .map_err(|e| format!("nearest: {e}"))?;

    // WS-VEC: get the vector-store master key once for the whole batch.
    // If the keychain is unavailable, enc_key is None and encrypted chunks fall
    // through to the "[content unavailable — keychain locked]" placeholder —
    // retrieval continues normally for any (pre-WS-VEC) plaintext rows.
    let enc_key = crypto::get_or_create_master_key().ok();

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
            Hit {
                path: h.path,
                chunk_text,
                score: embedder::cosine_distance_to_score(h.distance),
                paragraph_index: h.paragraph_index,
                // WS-B/C: carry the citation key + scope + source for the answer layer.
                id: if h.id.is_empty() { None } else { Some(h.id) },
                matter_id: h.matter_id,
                source_id: h.source_id,
                source_type: h.source_type,
                page_number: h.page_number,
                // WS-PRIV: carry the privilege status so an explicitly-included
                // privileged hit can be labelled. Default retrieval only returns "none".
                privilege: h.privilege,
                // VG-2: carry the OCR disclosure so citations can say
                // "scanned" / "low-confidence scan".
                extraction: h.extraction,
                extraction_confidence: h.extraction_confidence,
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
            Some(other) => Verdict::MatterMismatch {
                actual_matter: other.matter_id,
            },
            None => Verdict::NotFound,
        });
    };

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
    store::delete_path(&table, &path)
        .await
        .map_err(|e| format!("delete path: {e}"))?;
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
    let updated = store::retag_privilege_for_path(&table, &path, &privilege)
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
    let updated = store::retag_matter_for_path(&table, &path, &matter_id)
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
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
        assert!(s.contains("\"pageNumber\":1"), "got {}", s);
        // VG-2: the OCR disclosure crosses IPC camel-cased.
        assert!(s.contains("\"extraction\":\"ocr\""), "got {}", s);
        assert!(s.contains("\"extractionConfidence\":48.5"), "got {}", s);
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
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(!s.contains("sourceType"), "got {}", s);
        assert!(!s.contains("pageNumber"), "got {}", s);
        assert!(!s.contains("matterId"), "got {}", s);
        assert!(!s.contains("sourceId"), "got {}", s);
        assert!(!s.contains("privilege"), "got {}", s);
        // VG-2: native chunks carry no extraction keys at all.
        assert!(!s.contains("extraction"), "got {}", s);
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
        };
        let s = serde_json::to_string(&p).unwrap();
        assert!(s.contains("\"currentPath\":\"/w/x.md\""), "got {}", s);
        assert!(s.contains("\"processed\":12"));
        assert!(s.contains("\"total\":100"));
        assert!(s.contains("\"status\":\"Indexing\"") || s.contains("\"status\":\"indexing\""));
    }
}
