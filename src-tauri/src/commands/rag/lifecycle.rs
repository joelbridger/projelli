use super::*;

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
    let updated = store::with_scope_write_status(store::retag_privilege_for_path(
        &table, &path, &privilege, &key,
    ))
        .await
        .map_err(|e| format!("retag privilege: {e}"))?;
    // P1.1: keep the manifest's recorded scope in sync so a later reconcile
    // re-indexes a changed file under the NEW privilege, never a stale one.
    update_manifest_scope(&state, &workspace, &path, None, Some(&privilege), &key).await;
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
    let updated = store::with_scope_write_status(store::retag_matter_for_path(
        &table, &path, &matter_id, &key,
    ))
        .await
        .map_err(|e| format!("retag matter: {e}"))?;
    // P1.1: keep the manifest's recorded scope in sync so a later reconcile
    // re-indexes a changed file under the NEW matter, never a stale (wider) one.
    update_manifest_scope(&state, &workspace, &path, Some(&matter_id), None, &key).await;
    Ok(updated as u32)
}

/// P1.1 — BATCHED matter retag: apply `matter_id` to MANY sources' rows in one
/// LanceDB UPDATE (per 512-path chunk). The boot retag of a mapped client folder
/// calls this once per matter instead of re-embedding — or per-file retagging,
/// which LanceDB makes ~as slow as re-embedding (one data rewrite per UPDATE).
/// Also syncs each path's manifest scope.
///
/// QA-92 (round 2): returns the PER-PATH MISSES — the paths that STILL have no
/// rows under `matter_id` after the retag (never-indexed files, or a path-form
/// mismatch). The caller re-indexes exactly those. Returning per-path misses
/// (not the single aggregate rows-updated count) is what catches a MIXED batch:
/// a client folder holding a retaggable `plan.docx` plus a zero-row
/// `statement.pdf` has a non-zero count, so the aggregate would hide the pdf and
/// leave it invisible to client-scoped Ask. When the table is absent nothing is
/// indexed yet, so EVERY path is a miss (the caller indexes them all).
#[tauri::command]
pub async fn rag_retag_matter_batch(
    state: State<'_, RagState>,
    paths: Vec<String>,
    matter_id: String,
) -> Result<Vec<String>, String> {
    store::validate_matter_id(&matter_id).map_err(|e| format!("invalid matter id: {e}"))?;
    if paths.is_empty() {
        return Ok(Vec::new());
    }
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
        // No vector table yet → nothing is indexed → every path is a miss.
        return Ok(paths);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let updated = store::with_scope_write_status(store::retag_matter_for_paths(
        &table, &paths, &matter_id, &key,
    ))
        .await
        .map_err(|e| format!("batched retag matter: {e}"))?;
    // Keep the manifest's recorded scope in sync for every retagged source, in a
    // SINGLE load→modify→save (a per-path loop would defeat the batching).
    update_manifest_matter_many(&state, &workspace, &paths, &matter_id, &key).await;
    // QA-92: verify PER PATH which files actually landed rows under the target
    // matter; the rest are misses the caller must (re)index.
    let missing = store::paths_missing_rows_under_matter(&table, &paths, &matter_id, &key)
        .await
        .map_err(|e| format!("verify retag rows: {e}"))?;
    log::debug!(
        "rag retag batch: {} paths, {} rows updated, {} miss(es) under {}",
        paths.len(),
        updated,
        missing.len(),
        matter_id,
    );
    Ok(missing)
}

/// Number of scope/privacy updates waiting behind another search-index write.
/// This is a live status, not an error: the shared writer queue will run them in
/// order as soon as the current write finishes.
#[tauri::command]
pub async fn rag_scope_write_queue_depth() -> usize {
    store::scope_write_queue_depth()
}

/// P1.1 — set the recorded matter of MANY manifest entries in one
/// load→modify→save (paired with `rag_retag_matter_batch`).
async fn update_manifest_matter_many(
    state: &RagState,
    workspace: &Path,
    paths: &[String],
    matter: &str,
    key: &[u8; 32],
) {
    let _mg = state.manifest_lock.lock().await;
    let mut m = manifest::load(workspace, store::INDEX_VERSION);
    let mut changed = false;
    for p in paths {
        let token = crypto::path_token(key, p);
        if let Some(sig) = m.sources.get_mut(&token) {
            if sig.matter_id != matter {
                sig.matter_id = matter.to_string();
                changed = true;
            }
        }
    }
    if changed {
        if let Err(e) = manifest::save(workspace, &m) {
            log::warn!("rag: failed to save manifest after batched retag: {e}");
        }
    }
}

/// QA-92 — a PDF may be SKIPPED on boot only when its manifest signature is
/// stat-fresh AND it still has at least one vector row under its recorded scope.
/// PDF manifest entries record `row_count = 0` (the frontend indexes PDF chunks
/// on a separate path), so — unlike text/office — we can't compare an expected
/// count; ROW PRESENCE is the signal. A manifest-fresh PDF whose rows vanished
/// (vectors cache lost/rebuilt, or a prior partial OCR) must re-index, or it
/// stays unsearchable forever (the QA-92 pre-existing-files bug). Pure so the
/// decision is unit-tested without a live store.
pub(crate) fn pdf_can_skip(stat_fresh: bool, rows_present: usize) -> bool {
    stat_fresh && rows_present > 0
}

/// P1.1 (Task 3) — is this PDF already indexed at its current version + OCR
/// settings? The frontend PDF-index loop calls this BEFORE re-extracting a PDF so
/// an unchanged PDF (the expensive, often-OCR'd case) is skipped on boot. Returns
/// `false` (→ re-index) when the file is new/changed, tombstoned, or the manifest
/// can't be trusted — always fail-SAFE toward re-indexing, never toward skipping a
/// stale file.
#[tauri::command]
pub async fn rag_manifest_pdf_fresh(
    state: State<'_, RagState>,
    path: String,
    ocr_enabled: bool,
) -> Result<bool, String> {
    let workspace = require_workspace(&state).await?;
    // A fail-closed integrity-unknown store must re-index everything.
    if state.index_integrity_unknown.load(Ordering::SeqCst) {
        return Ok(false);
    }
    // Manifest key = the PDF's path token (matches how its rows are keyed, and
    // keeps no plaintext path on disk). The frontend passes the SAME `path` to
    // `rag_index_pdf_chunks`, so the token agrees with the stored rows.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let token = crypto::path_token(&key, &path);
    // A tombstoned PDF must re-index to clear the tombstone.
    if state.unsafe_tokens.lock().await.contains(&token) {
        return Ok(false);
    }
    let Some((size, mtime)) = manifest::stat_signature(Path::new(&path)) else {
        return Ok(false);
    };
    // Fail SAFE when the vector table is MISSING (vectors cache deleted/corrupted):
    // the store holds no rows, so trusting a "fresh" PDF signature would skip
    // re-indexing and leave that PDF out of search. Re-index instead. This closes
    // the race with the concurrent reconcile (which also rebuilds on a missing
    // table) — the check here is authoritative regardless of ordering.
    {
        let conn = store::open_connection(&workspace)
            .await
            .map_err(|e| format!("open lancedb: {e}"))?;
        let table_present = conn
            .table_names()
            .execute()
            .await
            .map_err(|e| format!("list tables: {e}"))?
            .iter()
            .any(|n| n == store::TABLE_NAME);
        if !table_present {
            return Ok(false);
        }
    }
    let m = manifest::load(&workspace, store::INDEX_VERSION);
    // Fail SAFE across a schema migration: if the manifest predates the current
    // INDEX_VERSION, the LanceDB table is about to be (or was just) dropped and
    // rebuilt, so its rows can't be trusted. Re-index the PDF rather than skip it.
    // (The text/office path escalates to a full walk via `effective_full`; this is
    // the equivalent guard for the separate, concurrent PDF-index path.)
    if m.index_version != store::INDEX_VERSION {
        return Ok(false);
    }
    let now = manifest::PdfInputs::current(ocr_enabled);
    let Some(sig) = m.get(&token) else {
        return Ok(false);
    };
    if !sig.is_fresh(size, mtime, Some(&now)) {
        return Ok(false);
    }
    // QA-92: a stat-fresh signature is not enough — prove the PDF's rows are
    // actually present under its recorded scope before skipping. PDF manifest
    // entries record row_count=0, so gate on PRESENCE (any row), not an expected
    // count, or every unchanged PDF would needlessly re-OCR on each boot.
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| format!("open table: {e}"))?;
    let rows =
        store::path_row_count_for_scope(&table, &path, &sig.matter_id, &sig.privilege, &key)
            .await
            .map_err(|e| format!("count pdf rows: {e}"))?;
    Ok(pdf_can_skip(true, rows))
}

/// P1.1 (Task 3) — record a PDF's signature after the frontend has successfully
/// indexed it, so a later boot can skip it while unchanged. Locked + merge-safe
/// with the Rust reconcile walk (which preserves PDF entries it doesn't own).
#[tauri::command]
pub async fn rag_manifest_record_pdf(
    state: State<'_, RagState>,
    path: String,
    matter_id: Option<String>,
    privilege: Option<String>,
    page_count: u32,
    ocr_enabled: bool,
) -> Result<(), String> {
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    let workspace = require_workspace(&state).await?;
    let Some((size, mtime_ns)) = manifest::stat_signature(Path::new(&path)) else {
        // File vanished between indexing and recording — nothing to record.
        return Ok(());
    };
    let sig = manifest::SourceSignature {
        size,
        mtime_ns,
        hash: None,
        extractor_version: manifest::EXTRACTOR_VERSION,
        chunker_version: manifest::CHUNKER_VERSION,
        embedder_version: manifest::EMBEDDER_VERSION.to_string(),
        pdf: Some(manifest::PdfSignature {
            pdf_extractor_version: manifest::PDF_EXTRACTOR_VERSION,
            ocr_enabled,
            ocr_version: manifest::OCR_VERSION,
            page_count,
        }),
        matter_id: matter,
        privilege,
        row_count: 0,
        indexed_at: now_unix_secs(),
    };
    // Key by the PDF's path token (matches its rows; no plaintext path on disk).
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let token = crypto::path_token(&key, &path);
    let _mg = state.manifest_lock.lock().await;
    let mut m = manifest::load(&workspace, store::INDEX_VERSION);
    m.index_version = store::INDEX_VERSION;
    m.insert(token, sig);
    manifest::save(&workspace, &m).map_err(|e| format!("save manifest: {e}"))?;
    Ok(())
}

/// P1.1 (Task 3) — forget ALL PDF manifest entries. Called when the user turns
/// PDF indexing OFF (which deletes every PDF's rows): without this, the stale
/// "fresh" signatures would make a later toggle-ON skip re-indexing PDFs whose
/// rows no longer exist, so they'd silently vanish from search. Text/office
/// entries are untouched.
#[tauri::command]
pub async fn rag_manifest_forget_pdfs(state: State<'_, RagState>) -> Result<(), String> {
    let workspace = require_workspace(&state).await?;
    let _mg = state.manifest_lock.lock().await;
    let mut m = manifest::load(&workspace, store::INDEX_VERSION);
    let before = m.sources.len();
    m.sources.retain(|_, sig| sig.pdf.is_none());
    if m.sources.len() != before {
        manifest::save(&workspace, &m).map_err(|e| format!("save manifest: {e}"))?;
    }
    Ok(())
}

// ── QA-92: a manifest-"fresh" PDF whose vector rows are gone must re-index, not
//    be skipped on boot (the pre-existing-files-invisible bug, PDF path) ──
#[cfg(test)]
mod qa92_pdf_tests {
    use super::*;

    // RED before the fix: the pre-fix path skipped a stat-fresh PDF even with
    // zero surviving rows, leaving it unsearchable forever.
    #[test]
    fn manifest_fresh_pdf_with_zero_rows_must_not_skip() {
        assert!(!pdf_can_skip(true, 0));
    }

    // A genuinely-indexed PDF must still skip (no needless re-OCR every boot).
    #[test]
    fn manifest_fresh_pdf_with_rows_may_skip() {
        assert!(pdf_can_skip(true, 4));
    }

    // A changed/stale PDF never skips, rows or not.
    #[test]
    fn stale_pdf_never_skips_regardless_of_rows() {
        assert!(!pdf_can_skip(false, 10));
    }
}
