use super::*;
use crate::commands::mail::provider::MailProvider;
use crate::commands::mail::store::{EncryptedMailStore, MailStore};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use super::state::MailIndexChunkPayload;

/// Option B healing: re-index mail that was imported while the embedding model
/// was still downloading. During that window each message's RAG indexing fails
/// fast (model-not-ready) and delta sync never re-delivers it, so without this
/// pass that mail would NEVER gain semantic recall. The canonical encrypted
/// bodies are local, so healing needs no network.
///
/// Cheap by design: when the persistent `rag_backfill_needed` marker is absent
/// (the common case) this returns Ok(0) after a single row read, so the
/// frontend can call it on every boot / model-ready transition. When the marker
/// is set, every stored message is walked; messages that already have chunks
/// are skipped (ONE batched path scan up front, then set membership), the rest
/// are re-run through the SAME indexing path the sync uses
/// (`index_mail_text_internal`, which is delete-then-insert by source id, so no
/// duplicate chunks are possible).
///
/// Marker lifecycle: the marker survives a pass ONLY when the model went
/// missing mid-pass (model-not-ready failures) — those messages WILL succeed
/// once the model is back, so retrying on the next boot is correct. Any other
/// pass is terminal and clears the marker: fully successful, or one whose only
/// failures were non-model ones (logged loudly with their ids and NOT retried
/// automatically — a poison message must not re-walk the mailbox every boot).
/// See `backfill_marker_disposition`.
///
/// `matter_map` is the frontend's (provider, account, folder) -> matter mapping
/// (same shape `mail_sync_all` takes) so each backfilled message is scoped
/// exactly as a sync would have scoped it.
#[tauri::command]
pub async fn mail_backfill_rag(
    state: State<'_, MailState>,
    matter_map: Option<Vec<MailMatterMapEntry>>,
) -> Result<u32, String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;

    // Fast no-op #1: no encrypted mail DB → mail was never imported in this
    // workspace. Returns before touching the OS keychain so an ordinary boot
    // never creates a mail master key (or prompts for keychain access).
    if !EncryptedMailStore::db_path(&workspace).exists() {
        return Ok(0);
    }

    let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;

    // Fast no-op #2: marker absent → nothing to heal (one row read).
    let ws_probe = workspace.clone();
    let key_probe = enc_key;
    let needed = match tokio::task::spawn_blocking(move || -> anyhow::Result<bool> {
        let store = EncryptedMailStore::open_with_key(&ws_probe, &key_probe)?;
        Ok(store.get_meta(RAG_BACKFILL_NEEDED_KEY)?.is_some())
    })
    .await
    .map_err(|e| format!("join: {e}"))?
    {
        Ok(n) => n,
        Err(e) => {
            // A real DB error, NOT "marker absent" (get_meta distinguishes the
            // two). Don't guess in either direction: skip the backfill this
            // boot — the marker (if any) is untouched, so the next boot
            // re-probes and self-corrects.
            log::warn!("mail RAG backfill: marker probe failed; skipping this boot: {e:#}");
            return Err(format!("read backfill marker: {e:#}"));
        }
    };
    if !needed {
        return Ok(0);
    }

    // The embedding model must be present, or every message would just re-fail.
    // Bail with the typed marker; the backfill marker stays set for the next try.
    {
        let dir = crate::commands::rag::embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            crate::commands::rag::model_download::model_files_cached(&dir)
        })
        .await
        .map_err(|e| e.to_string())?;
        if !cached {
            return Err(format!(
                "{}: mail RAG backfill deferred until the model downloads",
                crate::commands::rag::embedder::MODEL_NOT_READY
            ));
        }
    }

    // Mutual exclusion with mail_sync_all: both delete-then-insert the same
    // LanceDB rows, so a concurrent pass over the same message could duplicate
    // chunks. Claim the same sync slot; if a sync is running, bail — the
    // marker stays set and the next boot / model-ready signal retries. Note
    // this excludes a RUNNING sync; in-flight spawned index tasks from a
    // just-finished sync may briefly overlap (bounded: delete-then-insert
    // self-heals on the next index of that message).
    if state
        .is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    let matter_map = matter_map.unwrap_or_default();

    // Collect every stored message record (empty filters are wildcards, so this
    // spans all providers/accounts/folders).
    let ws_list = workspace.clone();
    let key_list = enc_key;
    let (store, records) = tokio::task::spawn_blocking(
        move || -> anyhow::Result<(EncryptedMailStore, Vec<store::MailRecord>)> {
            let store = EncryptedMailStore::open_with_key(&ws_list, &key_list)?;
            let ids = store.ids_in_folder("", "", "")?;
            let mut records = Vec::with_capacity(ids.len());
            for id in ids {
                if let Some(rec) = store.get_record(&id)? {
                    records.push(rec);
                }
            }
            Ok((store, records))
        },
    )
    .await
    .map_err(|e| format!("join: {e}"))?
    .map_err(|e| format!("list mail records: {e:#}"))?;
    let store = Arc::new(store);

    // Open the RAG table once and batch the already-indexed probe: ONE scan of
    // all mail chunk paths into a set, instead of a count_rows query per
    // message. If the scan itself fails, warn and treat it as empty — the
    // indexing below is delete-then-insert (idempotent), so the worst case is
    // redundant re-index work, never a gap.
    let conn = crate::commands::rag::store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;
    // VG-6e: the probe decrypts the path_enc column back to plaintext
    // "mail:<id>" keys (the path column holds tokens now), so it needs the
    // VECTOR-store key. Key unavailable degrades exactly like a failed scan:
    // empty set → redundant re-index work, never a gap.
    let indexed_paths = match crate::commands::rag::crypto::get_or_create_master_key() {
        Ok(vec_key) => {
            match crate::commands::rag::store::list_indexed_mail_paths(&table, &vec_key).await {
                Ok(set) => set,
                Err(e) => {
                    log::warn!(
                        "mail RAG backfill: indexed-paths scan failed (re-indexing all): {e:#}"
                    );
                    std::collections::HashSet::new()
                }
            }
        }
        Err(e) => {
            log::warn!(
                "mail RAG backfill: vectors key unavailable for the indexed-paths scan \
                 (re-indexing all): {e:#}"
            );
            std::collections::HashSet::new()
        }
    };

    let total = records.len();
    let mut indexed = 0u32;
    // Failure buckets drive the end-of-pass marker disposition: model-not-ready
    // failures mean "a retry after the model returns heals"; anything else is
    // terminal for automatic-retry purposes.
    let mut model_failures = 0usize;
    let mut other_failures = 0usize;
    let mut failed_ids: Vec<String> = Vec::new();
    for rec in records {
        let path_key = format!("mail:{}", rec.id);

        // Skip messages that already have chunks (indexed before the model
        // went missing, or by an earlier partial pass) — set membership against
        // the one batched scan above. This keeps repeated passes cheap even if
        // one poison message keeps the marker set.
        if indexed_paths.contains(&path_key) {
            continue;
        }

        // Decrypt the canonical body (blocking fs + AES) off the runtime.
        let store_read = store.clone();
        let ws_read = workspace.clone();
        let rel = rec.relative_path.clone();
        let key_read = enc_key;
        let text = match tokio::task::spawn_blocking(move || -> anyhow::Result<String> {
            let bytes = store_read.read_blob_with_key(&rel, &ws_read, &key_read)?;
            Ok(String::from_utf8(bytes)?)
        })
        .await
        {
            Ok(Ok(t)) => t,
            Ok(Err(e)) => {
                log::warn!("mail RAG backfill: read body for {path_key} failed: {e:#}");
                other_failures += 1;
                failed_ids.push(path_key);
                continue;
            }
            Err(e) => {
                log::warn!("mail RAG backfill: join for {path_key} failed: {e}");
                other_failures += 1;
                failed_ids.push(path_key);
                continue;
            }
        };

        // BUG-013: a durable per-message filing wins over the folder mapping, so
        // re-indexing (backfill) preserves a manual "file to matter" instead of
        // reverting it to the folder default. Absent override → folder matter.
        // BUG-042: an "unassigned" tombstone stays unassigned (not re-absorbed
        // into the folder's matter).
        let folder_default =
            resolve_mail_matter(&matter_map, &rec.provider, &rec.account, &rec.folder_id);
        let matter =
            resolve_effective_matter(store.get_message_matter(&rec.id).ok().flatten().as_deref(), &folder_default);

        match index_mail_text_internal(&workspace, &path_key, &text, &matter).await {
            Ok(_) => indexed += 1,
            Err(e) => {
                log::warn!("mail RAG backfill index for {path_key} failed: {e:#}");
                if embed_error_is_model_not_ready(&e) {
                    // Everything after this would fail the same way — stop the
                    // walk; the disposition below keeps the marker so the next
                    // boot / ready signal retries.
                    model_failures += 1;
                    break;
                }
                other_failures += 1;
                failed_ids.push(path_key);
            }
        }
    }

    // End-of-pass marker lifecycle (see `backfill_marker_disposition`).
    if backfill_marker_disposition(model_failures, other_failures)
        == BackfillMarkerDisposition::Retain
    {
        // The model regressed mid-pass: the un-indexed remainder WILL succeed
        // once it is back, so the marker must survive for the next boot.
        return Err(format!(
            "{}: mail RAG backfill aborted (model became unavailable); will retry on the next start",
            crate::commands::rag::embedder::MODEL_NOT_READY
        ));
    }

    // Terminal pass (the model was present throughout): surface any permanent
    // failures loudly, then clear the marker either way — retrying a non-model
    // failure every boot would never fix it, just re-walk the mailbox.
    if !failed_ids.is_empty() {
        log::warn!(
            "mail backfill: {} message(s) permanently failed to index and will NOT be retried automatically: {failed_ids:?}",
            failed_ids.len()
        );
    }
    let store_clear = store.clone();
    tokio::task::spawn_blocking(move || store_clear.delete_meta(RAG_BACKFILL_NEEDED_KEY))
        .await
        .map_err(|e| format!("join: {e}"))?
        .map_err(|e| format!("clear backfill marker: {e:#}"))?;
    // Release the once-per-session mark latch so a LATER incident in this
    // session (e.g. the model is deleted and a new sync fails) can re-mark.
    MARKED_THIS_SESSION.store(false, Ordering::SeqCst);

    if other_failures > 0 {
        return Err(format!(
            "mail RAG backfill: {other_failures} of {total} messages permanently failed; not retrying automatically (ids in the log)"
        ));
    }

    Ok(indexed)
}
/// G4 / N2: Internal mail RAG indexer — takes raw parameters instead of Tauri
/// State, called directly from the sync callback without going through IPC.
/// The former rag_index_mail_text Tauri command (which shipped plaintext over
/// IPC) has been removed (N2); this function is the sole indexing path.
///
/// `path_key` is already formatted as "mail:<doc_id>" by the caller.
/// Encrypts chunk text before storing in LanceDB. Idempotent (deletes stale
/// rows first). Returns Ok(0) if plaintext is empty. Errors are logged by caller.
///
/// WS-B/C: `matter_id` is the confidentiality scope this email is filed under.
/// The matter model / assignment UI is a separate upcoming task; until an email
/// is assigned to a matter, callers pass `store::UNASSIGNED_MATTER` so the chunk
/// is scopeable and never silently leaks into a real matter.
pub(crate) async fn index_mail_text_internal(
    workspace: &std::path::Path,
    path_key: &str,
    plaintext: &str,
    matter_id: &str,
) -> anyhow::Result<u32> {
    use anyhow::Context;
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    // WS-VEC: the RAG-index copy of the mail text is encrypted at rest under the
    // dedicated VECTOR-STORE key (not the mail-body key), so the whole `chunks`
    // table decrypts under one key. The canonical encrypted mail body lives in
    // the mail store under the mail key; this is a derived copy.
    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .context("vectors master key for mail RAG index")?;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for mail indexing")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    let chunks = crate::commands::rag::chunker::chunk_text(path_key, plaintext);

    // Delete stale rows before inserting (idempotent). VG-6e: the delete
    // matches the tokenized path column via the vector key.
    crate::commands::rag::store::delete_path(&table, path_key, &key)
        .await
        .context("delete stale mail chunks")?;

    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // F-501-class hardening: bounded batches even for a pathological multi-MB
    // plaintext body. No cancel flag on the mail path, so Some is guaranteed.
    let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed mail chunks")?
        .unwrap_or_default();
    let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();

    // WS-PRIV: mail is indexed at PRIVILEGE_NONE (the default). Mail sync runs
    // from the server and has no privilege signal of its own; the user marks a
    // message privileged in the UI, which writes the privilege store and re-tags
    // these chunks in place via `rag_retag_privilege` (parallel to how a mail's
    // matter is assigned after indexing, not at sync time).
    let batch = crate::commands::rag::store::build_batch_mail(
        &rows,
        &key,
        matter_id,
        crate::commands::rag::store::PRIVILEGE_NONE,
    )
    .context("build mail batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    let _write = crate::commands::rag::store::acquire_write_access(&table).await?;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add mail chunks to lancedb")?;

    Ok(rows.len() as u32)
}

/// Marker key in the encrypted mail store's `meta` table: set when one or more
/// messages could not be RAG-indexed during sync because the embedding model
/// was not downloaded yet (the Option B gate). Delta sync never re-delivers
/// those messages, so without this marker mail imported before model-ready
/// would NEVER gain semantic recall. `mail_backfill_rag` re-indexes from the
/// local encrypted bodies and clears the marker after a terminal pass (see its
/// marker-lifecycle doc and `backfill_marker_disposition`).
pub const RAG_BACKFILL_NEEDED_KEY: &str = "rag_backfill_needed";

/// True when an indexing error chain means "the embedding model is not
/// downloaded yet". Matches the FULL anyhow chain (`{:#}`) because the typed
/// marker sits at the root cause underneath `.context()` wrappers (e.g.
/// "embed mail chunks: model-not-ready: ..."); plain Display shows only the
/// outermost context and would lose it.
pub(crate) fn embed_error_is_model_not_ready(e: &anyhow::Error) -> bool {
    format!("{e:#}").contains(crate::commands::rag::embedder::MODEL_NOT_READY)
}

/// End-of-pass decision for the persistent backfill marker, given the failure
/// buckets a `mail_backfill_rag` pass observed. Pure so the policy is
/// unit-testable.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum BackfillMarkerDisposition {
    /// Clear the marker: the pass was terminal. Either everything indexed, or
    /// the only failures were non-model ones that an automatic retry would
    /// never fix (the caller logs those loudly instead).
    Clear,
    /// Keep the marker: the model went missing mid-pass, so the un-indexed
    /// remainder WILL succeed once it returns — the next boot must retry.
    Retain,
}

pub(crate) fn backfill_marker_disposition(
    model_failures: usize,
    other_failures: usize,
) -> BackfillMarkerDisposition {
    match (model_failures, other_failures) {
        // The model regressed mid-pass → a retry after it returns heals; keep
        // the marker.
        (m, _) if m > 0 => BackfillMarkerDisposition::Retain,
        // Model present throughout → anything still failing is terminal;
        // clear (the caller warns loudly with the failed ids).
        _ => BackfillMarkerDisposition::Clear,
    }
}

/// Process-level latch: true once `mark_rag_backfill_needed` has persisted the
/// marker this session. A burst of N messages failing in one sync would
/// otherwise open N SQLCipher connections just to upsert the same row. Reset
/// where the marker is cleared (the terminal end of a `mail_backfill_rag`
/// pass) so a later incident in the same session can re-mark.
pub(crate) static MARKED_THIS_SESSION: AtomicBool = AtomicBool::new(false);

/// Test-only mutual exclusion for `MARKED_THIS_SESSION`. `cargo test` runs
/// tests as threads in one process, so any two `#[test]` functions that read
/// or write this process-global latch can interleave. Every test touching
/// the latch must hold this lock for its full body (see
/// `commands::mail::mod::tests::backfill_marker_set_is_idempotent_and_clearable`
/// and `vector_rebuild_marker_skips_missing_store_and_bypasses_stale_latch`).
#[cfg(test)]
pub(crate) static MARKED_THIS_SESSION_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Persist the "mail needs a RAG backfill" marker for `workspace`. Idempotent;
/// one row in the encrypted mail store's meta table, written at most once per
/// session (see `MARKED_THIS_SESSION`).
pub(crate) fn mark_rag_backfill_needed(
    workspace: &std::path::Path,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    // Claim the session latch first so concurrent failures collapse to one
    // write.
    if MARKED_THIS_SESSION.swap(true, Ordering::SeqCst) {
        return Ok(()); // already persisted this session
    }
    let result = EncryptedMailStore::open_with_key(workspace, key)
        .and_then(|store| store.set_meta(RAG_BACKFILL_NEEDED_KEY, "1"));
    if result.is_err() {
        // Nothing was persisted — release the latch so the next failing
        // message retries the write instead of trusting a marker that isn't
        // there.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    }
    result
}

/// A destructive vector-store rebuild removes derived mail chunks too. Unlike
/// the sync-failure path, this must persist the marker even if this process
/// already marked once earlier and the session latch is stale.
///
/// Returns `Ok(false)` when the workspace has no encrypted mail store, matching
/// `mail_backfill_rag`'s fast no-op and avoiding accidental DB creation.
pub(crate) fn mark_rag_backfill_needed_after_vector_rebuild(
    workspace: &std::path::Path,
    key: &[u8; 32],
) -> anyhow::Result<bool> {
    if !EncryptedMailStore::db_path(workspace).exists() {
        return Ok(false);
    }
    MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    mark_rag_backfill_needed(workspace, key)?;
    Ok(true)
}

/// Check, at the end of a provider's sync, whether the just-imported mail is NOT
/// yet fully searchable — so the terminal event can honestly say "indexing still
/// finishing in the background" instead of asserting "searchable". Three
/// independent signals, any of which means "pending":
///
/// 1. Mail index tasks are still running or queued (`mail_indexing_in_flight`).
///    This is the large-import case the coordinator flagged: the model is present
///    but per-message indexing is still draining behind the 4-slot semaphore, so
///    claiming "all searchable" at terminal-event time would be a lie.
/// 2. The durable backfill marker is already set (a fire-and-forget index task
///    failed and recorded it — see `spawn_mail_rag_index`).
/// 3. This section imported messages (`wrote_any`) but the embedding model is
///    not downloaded yet, so none of them could have been indexed. Deterministic.
///
/// Correctness (no message is ever silently un-indexed) is still guaranteed by
/// the durable marker + the next-launch `mail_backfill_rag`; this read makes the
/// terminal CLAIM honest. Any error reading the marker is treated as "not pending".
async fn rag_backfill_pending(workspace: &std::path::Path, key: &[u8; 32], wrote_any: bool) -> bool {
    // Cheapest and most important signal: any mail index task still running or
    // queued behind the semaphore means the just-imported mail is NOT fully
    // searchable yet. Report pending so the terminal event says "search indexing
    // finishing in the background" instead of prematurely asserting "searchable".
    // This is the common large-import case (model present, work still draining).
    if mail_indexing_in_flight() {
        return true;
    }
    let ws = workspace.to_path_buf();
    let k = *key;
    let marker_set = tokio::task::spawn_blocking(move || -> anyhow::Result<bool> {
        let store = EncryptedMailStore::open_with_key(&ws, &k)?;
        Ok(store.get_meta(RAG_BACKFILL_NEEDED_KEY)?.is_some())
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .unwrap_or(false);
    if marker_set {
        return true;
    }
    if wrote_any {
        let dir = crate::commands::rag::embedder::resolve_cache_dir();
        let cached = tokio::task::spawn_blocking(move || {
            crate::commands::rag::model_download::model_files_cached(&dir)
        })
        .await
        .unwrap_or(false);
        if !cached {
            return true;
        }
    }
    false
}

/// Cap on concurrent mail RAG indexing tasks (BUG-011). Each indexed message
/// runs a CPU-heavy embedding (ONNX, which itself spawns inference threads).
/// `spawn_mail_rag_index` is fire-and-forget per message, so a large mailbox
/// import (thousands of messages arriving faster than embedding completes) used
/// to spawn thousands of simultaneous embedding tasks at once → memory/thread
/// exhaustion → allocation failure → the whole app aborted mid-import (this
/// happened with 22 GB free, i.e. it was unbounded concurrency, not low RAM).
/// Every spawned task now waits on this semaphore before doing heavy work, so at
/// most N embeddings run concurrently; the rest queue cheaply (holding only
/// their text). 4 keeps throughput while staying far from the thousands that
/// crashed; `const_new` lets it be a plain static (no lazy init).
static MAIL_INDEX_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Monotonic, process-wide counters of mail RAG index tasks spawned vs finished.
/// `SPAWNED > COMPLETED` means indexing is still in flight (running, or queued
/// behind `MAIL_INDEX_SEMAPHORE`). A sync's terminal event reads this so it can
/// honestly say "search indexing still finishing in the background" instead of
/// asserting "all mail imported and searchable" while a large import's messages
/// are still queued — the claim the fire-and-forget design would otherwise make
/// prematurely. Never reset (syncs are serialized by `is_syncing`, and the delta
/// is what matters, not the absolute values).
pub(crate) static MAIL_INDEX_SPAWNED: AtomicU64 = AtomicU64::new(0);
pub(crate) static MAIL_INDEX_COMPLETED: AtomicU64 = AtomicU64::new(0);

/// True when at least one mail RAG index task is still running or queued. Used by
/// `rag_backfill_pending` so the terminal `done` outcome is conservative: it only
/// claims "searchable" once no indexing is outstanding.
pub(crate) fn mail_indexing_in_flight() -> bool {
    MAIL_INDEX_SPAWNED.load(Ordering::SeqCst) > MAIL_INDEX_COMPLETED.load(Ordering::SeqCst)
}

/// Increments `MAIL_INDEX_COMPLETED` on drop, so a finished index task is counted
/// on EVERY exit path — normal return, early `?`, or panic — and the in-flight
/// count can never get stuck above zero (which would wedge every later sync into
/// a permanent "indexing pending" claim).
struct IndexCompletionGuard;
impl Drop for IndexCompletionGuard {
    fn drop(&mut self) {
        MAIL_INDEX_COMPLETED.fetch_add(1, Ordering::SeqCst);
    }
}

/// Fire-and-forget mail RAG indexing, shared by every sync `index_callback`
/// (M365 / IMAP / Gmail). On failure it logs the FULL error chain and sets the
/// persistent backfill marker so `mail_backfill_rag` can heal this message later
/// from its local encrypted body.
fn spawn_mail_rag_index(
    workspace: std::path::PathBuf,
    path_key: String,
    text: String,
    matter_id: String,
    enc_key: [u8; 32],
) {
    // Count the task as spawned SYNCHRONOUSLY, before the async task starts, so a
    // section that finishes its folder loop and reads `mail_indexing_in_flight()`
    // never races ahead of a just-queued task that hasn't run its increment yet.
    MAIL_INDEX_SPAWNED.fetch_add(1, Ordering::SeqCst);
    let _ = tokio::task::spawn(async move {
        // Balances the SPAWNED increment on every exit (incl. panic / early return).
        let _done = IndexCompletionGuard;
        // Bound concurrent embedding work (BUG-011). Held for the whole index
        // call; if the semaphore is ever closed (it never is — it's a static)
        // we still proceed rather than silently dropping the message.
        let _permit = MAIL_INDEX_SEMAPHORE.acquire().await.ok();
        if let Err(e) =
            index_mail_text_internal(&workspace, &path_key, &text, &matter_id).await
        {
            // {:#} = full anyhow chain, so the log shows root causes.
            log::warn!("mail RAG index failed for {}: {:#}", path_key, e);
            // Mark the backfill on ANY index failure, not only model-not-ready
            // (the previous behavior silently lost every other kind of failure —
            // a transient LanceDB/IO error meant that message never became
            // searchable and was never retried). `mail_backfill_rag` re-derives
            // the model-vs-other failure split on its next pass, so a truly
            // permanent failure is retried once and then dropped loudly with its
            // id in the log — never silently. A non-model failure whose cause has
            // cleared by the next launch heals automatically.
            let ws = workspace.clone();
            match tokio::task::spawn_blocking(move || mark_rag_backfill_needed(&ws, &enc_key)).await
            {
                Ok(Ok(())) => {}
                Ok(Err(me)) => {
                    log::warn!("mail RAG backfill marker not set: {me:#}");
                }
                Err(join) => {
                    log::warn!("mail RAG backfill marker join failed: {join}");
                }
            }
        }
    });
}

/// Should this provider be synced, given an optional single-provider scope?
/// `None` means "sync every connected provider" (a full refresh); `Some(p)`
/// restricts the sync to provider `p`. A connector panel passes its own provider
/// so connecting one account never touches another account's (possibly stale)
/// credentials — which is what used to make connecting Microsoft 365 fail on a
/// left-over Gmail token.
pub(crate) fn should_sync_provider(only: &Option<String>, provider: &str) -> bool {
    match only {
        Some(p) => p == provider,
        None => true,
    }
}

/// Emit one provider-tagged progress event. Every connector panel filters to its
/// own provider, so the tag is what keeps one account's status/count from
/// appearing on another account's panel.
fn emit_sync_progress(app: &AppHandle, provider: &str, status: &str, written: u32, removed: u32) {
    let _ = app.emit(
        SYNC_PROGRESS_EVENT,
        SyncProgress {
            status: status.to_string(),
            provider: provider.to_string(),
            folder: None,
            written,
            removed,
            error: None,
            backfill_pending: false,
            token_warning: false,
        },
    );
}

/// Build the per-message RAG index callback (identical for every provider): spawn
/// fire-and-forget LanceDB indexing (G4) and emit the decrypted-text event the
/// renderer feeds into MiniSearch (G5). Extracted so all three provider sections
/// share one implementation instead of three copies.
fn make_index_callback(
    workspace: std::path::PathBuf,
    app: AppHandle,
    enc_key: [u8; 32],
) -> impl Fn(&str, &str, &str) + Send + Sync {
    move |id: &str, text: &str, matter_id: &str| {
        let path_key = format!("mail:{}", id);
        spawn_mail_rag_index(
            workspace.clone(),
            path_key,
            text.to_string(),
            matter_id.to_string(),
            enc_key,
        );
        let subject = frontmatter_subject(text);
        let _ = app.emit(
            MAIL_INDEX_CHUNK_EVENT,
            MailIndexChunkPayload {
                doc_id: id.to_string(),
                subject,
                decrypted_text: text.to_string(),
            },
        );
    }
}

/// Build the per-message tombstone callback (identical for every provider):
/// delete the deleted message's LanceDB RAG chunks (keyed "mail:<id>") so it stops
/// surfacing in retrieval (S3). Extracted to share one implementation.
fn make_tombstone_callback(workspace: std::path::PathBuf) -> impl Fn(&str) + Send + Sync {
    move |id: &str| {
        let path_key = format!("mail:{}", id);
        let ws = workspace.clone();
        let _ = tokio::task::spawn(async move {
            // Reuse the same store::delete_path helper used by rag_delete_path.
            match crate::commands::rag::store::open_connection(&ws).await {
                Ok(conn) => {
                    let names = conn.table_names().execute().await.unwrap_or_default();
                    if names.iter().any(|n| n == crate::commands::rag::store::TABLE_NAME) {
                        if let Ok(table) = conn
                            .open_table(crate::commands::rag::store::TABLE_NAME)
                            .execute()
                            .await
                        {
                            // VG-6e: the delete matches the tokenized path column — needs the vector key.
                            match crate::commands::rag::crypto::get_or_create_master_key() {
                                Ok(vec_key) => {
                                    if let Err(e) = crate::commands::rag::store::delete_path(
                                        &table, &path_key, &vec_key,
                                    )
                                    .await
                                    {
                                        log::warn!(
                                            "S3 tombstone: delete RAG chunks for {} failed: {}",
                                            path_key,
                                            e
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "S3 tombstone: vectors key unavailable for {}: {}",
                                        path_key,
                                        e
                                    );
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("S3 tombstone: open lancedb for {} failed: {}", path_key, e);
                }
            }
        });
    }
}

/// Sync one folder, emitting provider-tagged progress whose counts are CUMULATIVE
/// across the provider's folders: `base_written`/`base_removed` are the totals
/// from already-completed folders, so the displayed number only ever grows. (Each
/// folder's own counter resets to 0, which made a multi-folder Gmail backfill look
/// like it kept "starting over".) Returns this folder's own stats so the caller
/// can advance the base.
#[allow(clippy::too_many_arguments)]
async fn sync_one_folder(
    app: &AppHandle,
    event_provider: &str,
    provider: &dyn MailProvider,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    folder: &crate::commands::mail::provider::RemoteFolder,
    account: &str,
    matter_id: &str,
    enc_key: &[u8; 32],
    base_written: u32,
    base_removed: u32,
) -> anyhow::Result<sync::PageStats> {
    let app2 = app.clone();
    let ep = event_provider.to_string();
    let emit = move |w: u32, r: u32| {
        let _ = app2.emit(
            SYNC_PROGRESS_EVENT,
            SyncProgress {
                status: "syncing".into(),
                provider: ep.clone(),
                folder: None,
                written: base_written.saturating_add(w),
                removed: base_removed.saturating_add(r),
                error: None,
                backfill_pending: false,
                token_warning: false,
            },
        );
    };
    let index_callback = make_index_callback(workspace.to_path_buf(), app.clone(), *enc_key);
    let tombstone_callback = make_tombstone_callback(workspace.to_path_buf());
    sync::sync_folder_provider(
        provider,
        store,
        workspace,
        folder,
        account,
        matter_id,
        enc_key,
        &emit,
        &index_callback,
        &tombstone_callback,
    )
    .await
}

/// Terminal outcome of one provider's sync section.
enum SectionOutcome {
    /// Completed; carries the provider's cumulative written/removed totals and
    /// whether a RAG backfill is pending (some imported messages could not be
    /// indexed for search yet — e.g. the embedding model is still downloading —
    /// so recall is deferred to the next-launch backfill, never silently lost).
    Done {
        written: u32,
        removed: u32,
        backfill_pending: bool,
        /// Microsoft 365 refresh-token rotation failed to persist during this
        /// section (M365 only; always false for IMAP/Gmail).
        token_warning: bool,
    },
    /// The user cancelled mid-sync.
    Cancelled,
}

/// Translate one provider section's result into its provider-tagged terminal
/// event. Called after the section's own folder loop; a section failure is
/// isolated here (it emits that provider's `error` event and is logged) so it
/// never aborts or error-flags the other providers in a full sync.
fn finish_section(app: &AppHandle, provider: &str, result: Result<SectionOutcome, String>) {
    match result {
        Ok(SectionOutcome::Done {
            written,
            removed,
            backfill_pending,
            token_warning,
        }) => {
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "done".into(),
                    provider: provider.to_string(),
                    folder: None,
                    written,
                    removed,
                    error: None,
                    backfill_pending,
                    token_warning,
                },
            );
        }
        Ok(SectionOutcome::Cancelled) => emit_sync_progress(app, provider, "cancelled", 0, 0),
        Err(e) => {
            // Log the failure (the raw provider text never reaches the audit log —
            // the frontend stores only a sanitized category). Carry the raw
            // message in the event so the owner sees WHY on their own screen,
            // instead of a bare "ran into a problem".
            log::warn!("{provider} mail sync failed: {e}");
            let _ = app.emit(
                SYNC_PROGRESS_EVENT,
                SyncProgress {
                    status: "error".into(),
                    provider: provider.to_string(),
                    folder: None,
                    written: 0,
                    removed: 0,
                    error: Some(e),
                    backfill_pending: false,
                    token_warning: false,
                },
            );
        }
    }
}

/// Sync every folder of the Microsoft 365 account. The access token is refreshed
/// before enumeration AND before each folder, so a long backfill never outlives
/// the ~3600s token lifetime. Counts accumulate across folders.
async fn sync_m365_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    let token = fresh_access_token().await?;
    let refresh = graph_token_refresh();
    let folders = crate::commands::mail::graph::GraphProvider::new_with_refresh(
        token,
        refresh.clone(),
    )
        .list_folders()
        .await
        .map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let token = fresh_access_token().await?;
        let provider =
            crate::commands::mail::graph::GraphProvider::new_with_refresh(token, refresh.clone());
        let folder_matter = resolve_mail_matter(matter_map, "m365", M365_ACCOUNT, &folder.id);
        let s = sync_one_folder(
            app, "m365", &provider, store, workspace, &folder, M365_ACCOUNT, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        // M365-only: whether a refresh-token rotation failed to persist this run.
        token_warning: M365_TOKEN_ROTATION_FAILED.load(Ordering::SeqCst),
    })
}

/// Sync every folder of the configured IMAP account. One provider instance for
/// all folders; counts accumulate across folders.
async fn sync_imap_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    let (imap_cfg, imap_pw) = match load_imap_config() {
        Some(v) => v,
        None => {
            return Ok(SectionOutcome::Done {
                written: 0,
                removed: 0,
                backfill_pending: false,
                token_warning: false,
            })
        }
    };
    use crate::commands::mail::imap::ImapProvider;
    let provider = ImapProvider {
        host: imap_cfg.host.clone(),
        port: imap_cfg.port,
        username: imap_cfg.username.clone(),
        password: imap_pw,
        account: imap_cfg.account.clone(),
    };
    let folders = provider.list_folders().await.map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let folder_matter = resolve_mail_matter(matter_map, "imap", &imap_cfg.account, &folder.id);
        let s = sync_one_folder(
            app, "imap", &provider, store, workspace, &folder, &imap_cfg.account, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        token_warning: false, // IMAP has no OAuth refresh-token rotation.
    })
}

/// Sync every folder/label of the Gmail account. The token is refreshed before
/// each folder. Counts accumulate across folders — Gmail exposes many labels, so
/// a per-folder counter visibly reset to 0 each label; now it is monotonic.
async fn sync_gmail_section(
    app: &AppHandle,
    store: &(dyn MailStore + Sync),
    workspace: &std::path::Path,
    enc_key: &[u8; 32],
    matter_map: &[MailMatterMapEntry],
    cancel: &Arc<AtomicBool>,
) -> Result<SectionOutcome, String> {
    use crate::commands::mail::gmail::GmailProvider;
    let token = fresh_gmail_access_token().await?;
    let folders = GmailProvider::new(token, GMAIL_ACCOUNT.to_string())
        .list_folders()
        .await
        .map_err(|e| e.to_string())?;
    let mut base = sync::PageStats::default();
    for folder in folders {
        if cancel.load(Ordering::SeqCst) {
            return Ok(SectionOutcome::Cancelled);
        }
        let token = fresh_gmail_access_token().await?;
        let provider = GmailProvider::new(token, GMAIL_ACCOUNT.to_string());
        let folder_matter = resolve_mail_matter(matter_map, "gmail", GMAIL_ACCOUNT, &folder.id);
        let s = sync_one_folder(
            app, "gmail", &provider, store, workspace, &folder, GMAIL_ACCOUNT, &folder_matter,
            enc_key, base.written, base.removed,
        )
        .await
        .map_err(|e| e.to_string())?;
        base.written += s.written;
        base.removed += s.removed;
    }
    let backfill_pending = rag_backfill_pending(workspace, enc_key, base.written > 0).await;
    Ok(SectionOutcome::Done {
        written: base.written,
        removed: base.removed,
        backfill_pending,
        // Gmail rotation is handled by its own token path; not flagged here.
        token_warning: false,
    })
}

/// Enumerate folders then sync each to its deltaLink, emitting provider-tagged
/// progress.
///
/// `matter_map` is the frontend's (provider, account, folder) -> matter mapping
/// (from the matter store). Each folder's mail is indexed under the resolved
/// matter at index time, falling back to `UNASSIGNED_MATTER` when unmapped.
///
/// `only_provider` optionally restricts the sync to a single provider ("m365" |
/// "imap" | "gmail"); a connector panel passes its own provider so connecting one
/// account never runs (or fails on) another account's credentials. Omit it (null)
/// to refresh every connected provider.
#[tauri::command]
pub async fn mail_sync_all(
    app: AppHandle,
    state: State<'_, MailState>,
    matter_map: Option<Vec<MailMatterMapEntry>>,
    only_provider: Option<String>,
) -> Result<(), String> {
    // Atomically claim the sync slot; reject if a sync is already running.
    // We do NOT reset `cancel` if we bail here — an in-flight sync owns it.
    if state.is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is already in progress".into());
    }
    // RAII guard: restores is_syncing=false on every exit path.
    let _sync_guard = SyncGuard(state.is_syncing.clone());

    // Only reset cancel now that we hold the sync slot.
    state.cancel.store(false, Ordering::SeqCst);
    // Clear the token-rotation warning so it reflects only this run.
    M365_TOKEN_ROTATION_FAILED.store(false, Ordering::SeqCst);

    let matter_map = matter_map.unwrap_or_default();

    // Per-provider terminal events (done/error/cancelled) are emitted INSIDE the
    // inner, per section, so one provider failing no longer error-flags the whole
    // sync (it used to emit a single global "error" that showed on every panel).
    let result = mail_sync_all_inner(&app, &state, &matter_map, &only_provider).await;
    if let Err(e) = &result {
        // A setup failure (workspace/store/key) happens BEFORE any provider section,
        // so no `finish_section` ran and no terminal event/audit row would exist —
        // only a rejected promise (which the all-provider UI can miss). Emit a
        // terminal error event so the outcome is visible AND leaves a durable
        // `mail.sync` audit row (via useMailSyncAudit), honoring the "never
        // silent" contract. A single-provider sync tags that provider (its panel
        // filters to it); a full sync tags every provider row so whichever panel
        // is open shows the failure.
        match &only_provider {
            Some(p) => finish_section(&app, p, Err(e.clone())),
            None => {
                for p in ["m365", "imap", "gmail"] {
                    finish_section(&app, p, Err(e.clone()));
                }
            }
        }
    }
    result
}

/// Inner worker for `mail_sync_all`. Runs each in-scope, connected provider in
/// its OWN fault-isolated section: one provider's failure emits that provider's
/// `error` event and is logged, but never aborts or error-flags the others. Each
/// section emits its own provider-tagged terminal event via `finish_section`.
async fn mail_sync_all_inner(
    app: &AppHandle,
    state: &State<'_, MailState>,
    matter_map: &[MailMatterMapEntry],
    only_provider: &Option<String>,
) -> Result<(), String> {
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or("workspace not set")?;
    let cancel = state.cancel.clone();

    // G7: Remove any plaintext Phase-1 Mail/ directory before the encrypted sync
    // begins. Idempotent: no-op if Mail/ does not exist.
    sync::migrate_plaintext(&workspace);

    let store = EncryptedMailStore::open(&workspace).map_err(|e| e.to_string())?;
    let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| e.to_string())?;

    // Each provider runs only if it is in scope (see `only_provider`) AND actually
    // connected/configured — so connecting one account never reaches into
    // another's (possibly stale) credentials, which is what made connecting
    // Microsoft 365 fail on a left-over Gmail token. `finish_section` emits the
    // provider-tagged terminal event; a section error is isolated to its own
    // provider and never aborts the others.
    // A connectedness probe returning Err (keychain/IO failure) is NOT the same as
    // "not connected" (Ok(false)): treating it as false would silently skip the
    // section, so a user-triggered sync would end with no terminal event and no
    // audit row. `Ok(false)` is a correct silent skip (the user never connected
    // that provider); `Err(_)` is surfaced as that provider's error outcome.
    if should_sync_provider(only_provider, "m365") {
        match mail_is_connected().await {
            Ok(true) => {
                let r =
                    sync_m365_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "m365", r);
            }
            Ok(false) => {}
            Err(e) => finish_section(
                app,
                "m365",
                Err(format!("could not check the Microsoft 365 sign-in: {e}")),
            ),
        }
    }

    if should_sync_provider(only_provider, "imap") {
        match load_imap_config_checked() {
            Ok(Some(_)) => {
                let r =
                    sync_imap_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "imap", r);
            }
            Ok(None) => {}
            Err(e) => finish_section(
                app,
                "imap",
                Err(format!("could not read the IMAP settings: {e}")),
            ),
        }
    }

    if should_sync_provider(only_provider, "gmail") {
        match gmail_is_connected().await {
            Ok(true) => {
                let r =
                    sync_gmail_section(app, &store, &workspace, &enc_key, matter_map, &cancel).await;
                finish_section(app, "gmail", r);
            }
            Ok(false) => {}
            Err(e) => finish_section(
                app,
                "gmail",
                Err(format!("could not check the Gmail sign-in: {e}")),
            ),
        }
    }

    Ok(())
}
