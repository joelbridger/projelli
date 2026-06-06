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
///   - `source_type`: `"text"` | `"pdf"` — absent on pre-A3 rows (null)
///   - `page_number`: 1-based page number for PDF chunks; absent on text/pre-A3 rows
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub chunk_text: String,
    pub score: f32,
    pub paragraph_index: u32,
    // A3: Optional so pre-A3 rows serialize cleanly (null in JS).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<u32>,
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
#[tauri::command]
pub async fn rag_index_file(
    state: State<'_, RagState>,
    path: String,
) -> Result<(), String> {
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

    index_one_file(&table, &file_path)
        .await
        .map_err(|e| format!("index_file failed: {e}"))?;
    Ok(())
}

/// Internal: extract → chunk → embed → upsert for one file.
async fn index_one_file(table: &lancedb::Table, file_path: &Path) -> anyhow::Result<()> {
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
    store::upsert_chunks_for_path(table, &path_str, rows, store::SourceType::Text).await?;
    Ok(())
}

/// Walk the active workspace and index every supported file. Emits
/// `rag-indexing-progress` events so the UI can render a banner. Honours
/// `rag_cancel_indexing` mid-walk.
#[tauri::command]
pub async fn rag_index_workspace(
    app: AppHandle,
    state: State<'_, RagState>,
) -> Result<(), String> {
    let workspace = require_workspace(&state).await?;
    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel = state.cancel_flag.clone();

    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

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
        if let Err(e) = index_one_file(&table, file).await {
            // Don't abort the whole walk on a single bad file — log and move on.
            log::warn!(
                "rag_index_workspace: failed to index {}: {}",
                file.display(),
                e
            );
        }
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

/// Embed `query` and return the top-k nearest stored chunks.
///
/// G4: mail chunks have encrypted text columns. This function decrypts them
/// in memory before returning. If decryption fails (key unavailable, tampered
/// data), the chunk is returned as "[mail content unavailable]" — retrieval
/// never panics or fails due to a bad mail chunk.
#[tauri::command]
pub async fn rag_retrieve(
    state: State<'_, RagState>,
    query: String,
    top_k: u32,
) -> Result<Vec<Hit>, String> {
    if query.trim().is_empty() || top_k == 0 {
        return Ok(Vec::new());
    }
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

    let raw = store::nearest(&table, &qvec, top_k as usize)
        .await
        .map_err(|e| format!("nearest: {e}"))?;

    // G4: try to get the master key once for the whole batch.
    // If the keychain is unavailable, enc_key is None and encrypted chunks
    // will fall through to the "[mail content unavailable — keychain locked]"
    // placeholder — retrieval continues normally for plaintext chunks.
    let enc_key = crate::commands::mail::crypto::get_or_create_master_key().ok();

    let mut hits: Vec<Hit> = raw
        .into_iter()
        .map(|h| {
            let chunk_text = if h.encrypted {
                // G4: Mail chunk — decrypt hex-encoded ciphertext.
                // On any failure (bad key, tampered, keychain locked): return
                // a placeholder string — do NOT crash or skip the chunk.
                if let Some(ref k) = enc_key {
                    hex::decode(&h.text)
                        .ok()
                        .and_then(|bytes| {
                            crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                        })
                        .and_then(|v| String::from_utf8(v).ok())
                        .unwrap_or_else(|| "[mail content unavailable]".to_string())
                } else {
                    "[mail content unavailable — keychain locked]".to_string()
                }
            } else {
                // Text / PDF chunk (or pre-G4 row): return as-is. No change from pre-G4.
                h.text
            };
            Hit {
                path: h.path,
                chunk_text,
                score: embedder::cosine_distance_to_score(h.distance),
                paragraph_index: h.paragraph_index,
                source_type: h.source_type,
                page_number: h.page_number,
            }
        })
        .collect();
    // LanceDB returns by ascending distance, which corresponds to
    // descending score, but sort defensively.
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(hits)
}

/// Index pre-encrypted mail text into the RAG store.
///
/// G4: Called after `apply_page_enc` decrypts a blob in memory.
/// `doc_id` is the mail message id (used as the `path` discriminator, prefixed
/// with "mail:" to separate the namespace from workspace file paths).
/// `plaintext` is the decrypted markdown. It is chunked + embedded in memory;
/// the chunk `text` column is stored encrypted (hex-encoded AES-256-GCM).
///
/// Precedent: `rag_index_pdf_chunks` already takes text, not a file path.
/// Idempotent — stale rows for the doc_id are deleted before inserting new ones.
#[tauri::command]
pub async fn rag_index_mail_text(
    state: State<'_, RagState>,
    doc_id: String,
    plaintext: String,
) -> Result<u32, String> {
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // Use "mail:<id>" as the path key so tombstones can use rag_delete_path.
    let path_key = format!("mail:{}", doc_id);
    let chunks = chunker::chunk_text(&path_key, &plaintext);

    // Delete stale rows for this mail id before upsert (idempotent).
    store::delete_path(&table, &path_key)
        .await
        .map_err(|e| format!("delete stale: {e}"))?;

    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embedder::embed_documents(&texts)
        .await
        .map_err(|e| format!("embed mail: {e}"))?;
    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();

    let key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| format!("get master key: {e}"))?;

    let batch = store::build_batch_mail(&rows, &key)
        .map_err(|e| format!("build mail batch: {e}"))?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .map_err(|e| format!("add mail chunks: {e}"))?;

    Ok(rows.len() as u32)
}

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
) -> Result<u32, String> {
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    let count = pdf_indexer::index_pdf_chunks(&table, &path, &pages, page_count)
        .await
        .map_err(|e| format!("index_pdf_chunks: {e}"))?;
    Ok(count as u32)
}

/// Convenience: register the RAG state with a Tauri builder. Called from
/// `lib.rs::run`'s setup hook.
pub fn manage_state<R: tauri::Runtime>(app: &tauri::App<R>) {
    app.manage(RagState::default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_serializes_camel_case_for_frontend() {
        let hit = Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            source_type: None,
            page_number: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        // Frontend types will read `paragraphIndex`, not `paragraph_index`.
        assert!(s.contains("\"paragraphIndex\":3"), "got {}", s);
        assert!(s.contains("\"chunkText\":\"para\""), "got {}", s);
        assert!(s.contains("\"score\":0.87"), "got {}", s);
        assert!(s.contains("\"path\":\"/w/doc.md\""), "got {}", s);
    }

    #[test]
    fn hit_round_trips_through_json() {
        let hit = Hit {
            path: "/a".into(),
            chunk_text: "b".into(),
            score: 0.5,
            paragraph_index: 1,
            source_type: None,
            page_number: None,
        };
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
            source_type: Some("pdf".into()),
            page_number: Some(1),
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(s.contains("\"sourceType\":\"pdf\""), "got {}", s);
        assert!(s.contains("\"pageNumber\":1"), "got {}", s);
    }

    #[test]
    fn hit_without_source_type_omits_fields() {
        let hit = Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
            source_type: None,
            page_number: None,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        assert!(!s.contains("sourceType"), "got {}", s);
        assert!(!s.contains("pageNumber"), "got {}", s);
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
