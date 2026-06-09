// RAG (Retrieval-Augmented Generation) commands — M1 implementation.
//
// Architecture (per docs/strategy/.../06-RECOMMENDATIONS_BY_LOE.md M1):
//   - Embeddings: fastembed-rs with `MultilingualE5Small` (intfloat/multilingual-e5-small,
//     384-dim ONNX). Lazy singleton in `embedder.rs`.
//   - Storage: LanceDB dataset per workspace at `<workspace>/.keepance/vectors/`,
//     one `chunks` table. Schema lives in `store.rs`.
//   - Chunker: paragraph-aware ~384-token windows with 64-token overlap
//     (`chunker.rs`). Pure / unit-tested.
//   - Extraction: text formats only for M1 (`extractor.rs`). Document
//     formats (xlsx/docx/pptx/rtf) handled in a follow-up — see TODO.
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
///   - a cancellation flag the in-flight workspace indexer polls.
#[derive(Default)]
pub struct RagState {
    pub workspace_root: Mutex<Option<PathBuf>>,
    pub cancel_flag: Arc<AtomicBool>,
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
/// Called once when the user opens a workspace, before any indexing.
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
    *guard = Some(target);
    state.cancel_flag.store(false, Ordering::SeqCst);
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

    index_one_file(&table, &file_path, &matter, &privilege, &key)
        .await
        .map_err(|e| format!("index_file failed: {e}"))?;
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

/// Internal: extract → chunk → embed → upsert for one file.
///
/// WS-B/C: `matter_id` is the confidentiality scope the file is filed under
/// (the caller supplies it; `UNASSIGNED_MATTER` when not yet categorized). Every
/// written chunk carries it — index-time enforcement, layer one of scoping.
async fn index_one_file(
    table: &lancedb::Table,
    file_path: &Path,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    let path_str = file_path.to_string_lossy().to_string();
    let Some(text) = extractor::read_text(file_path) else {
        // File missing or too big — drop any existing rows for safety.
        store::delete_path(table, &path_str).await?;
        return Ok(());
    };
    let chunks = chunker::chunk_text(&path_str, &text);
    if chunks.is_empty() {
        store::delete_path(table, &path_str).await?;
        return Ok(());
    }
    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embedder::embed_documents(&texts).await?;
    let rows: Vec<(chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();
    store::upsert_chunks_for_path(
        table,
        &path_str,
        rows,
        store::SourceType::Text,
        matter_id,
        privilege,
        key,
    )
    .await?;
    Ok(())
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
    let matter = resolve_matter(matter_id.as_deref())?;
    let workspace = require_workspace(&state).await?;
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
        if let Err(e) = index_one_file(&table, file, &matter, store::PRIVILEGE_NONE, &key).await {
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
#[tauri::command]
pub async fn rag_retrieve(
    state: State<'_, RagState>,
    query: String,
    top_k: u32,
    scope: RetrievalScope,
    include_privileged: Option<bool>,
) -> Result<Vec<Hit>, String> {
    if query.trim().is_empty() || top_k == 0 {
        return Ok(Vec::new());
    }
    // WS-PRIV: absent (legacy callers) or false → EXCLUDE privileged content.
    // Only an explicit `true` flips it. The default is the safe one.
    let include_privileged = include_privileged.unwrap_or(false);
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

    let qvec = embedder::embed_query(&query)
        .await
        .map_err(|e| format!("embed query: {e}"))?;

    let raw = store::nearest(
        &table,
        &qvec,
        top_k as usize,
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
            }
        })
        .collect();
    // LanceDB returns by ascending distance, which corresponds to
    // descending score, but sort defensively.
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
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

/// Whitespace-normalized containment test for citation verification. Collapses
/// runs of whitespace in both strings so a citation quote does not fail over a
/// stray newline introduced by chunking. An empty quote is treated as a
/// mismatch (an answer must quote something concrete to be verifiable).
fn text_contains_normalized(stored: &str, quoted: &str) -> bool {
    let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let q = normalize(quoted);
    if q.is_empty() {
        return false;
    }
    normalize(stored).contains(&q)
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

    let count = pdf_indexer::index_pdf_chunks(&table, &path, &pages, page_count, &matter, &privilege, &key)
        .await
        .map_err(|e| format!("index_pdf_chunks: {e}"))?;
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
        }
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
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
        assert!(s.contains("\"pageNumber\":1"), "got {}", s);
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
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(!s.contains("sourceType"), "got {}", s);
        assert!(!s.contains("pageNumber"), "got {}", s);
        assert!(!s.contains("matterId"), "got {}", s);
        assert!(!s.contains("sourceId"), "got {}", s);
        assert!(!s.contains("privilege"), "got {}", s);
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
