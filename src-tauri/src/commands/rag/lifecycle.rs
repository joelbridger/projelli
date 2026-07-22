use super::*;

fn validate_pdf_workspace_pin(
    current_workspace: &Path,
    current_activation: u64,
    expected_workspace: &str,
    expected_activation: u64,
    path: &str,
    operation: &str,
) -> Result<(), String> {
    let canonical = |candidate: &Path| {
        std::fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf())
    };
    let current = canonical(current_workspace);
    let expected = canonical(Path::new(expected_workspace));
    if current != expected || current_activation != expected_activation {
        return Err(format!(
            "{operation}: workspace changed; refusing stale PDF operation"
        ));
    }
    let pdf_path = canonical(Path::new(path));
    if !pdf_path.starts_with(&current) {
        return Err(format!(
            "{operation}: PDF path is outside the expected workspace"
        ));
    }
    Ok(())
}

async fn require_pinned_pdf_workspace(
    state: &RagState,
    expected_workspace: &str,
    expected_activation: u64,
    path: &str,
    operation: &str,
) -> Result<PathBuf, String> {
    let workspace = require_workspace(state).await?;
    let activation = state.workspace_activation.load(Ordering::SeqCst);
    validate_pdf_workspace_pin(
        &workspace,
        activation,
        expected_workspace,
        expected_activation,
        path,
        operation,
    )?;
    Ok(workspace)
}

async fn lock_pinned_pdf_commit<'a>(
    state: &'a RagState,
    expected_workspace: &str,
    expected_activation: u64,
    path: &str,
    operation: &str,
) -> Result<(tokio::sync::MutexGuard<'a, ()>, PathBuf), String> {
    let guard = state.workspace_switch_lock.lock().await;
    let workspace = require_pinned_pdf_workspace(
        state,
        expected_workspace,
        expected_activation,
        path,
        operation,
    )
    .await?;
    Ok((guard, workspace))
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
    expected_workspace: Option<String>,
    expected_activation: Option<u64>,
) -> Result<(), String> {
    let _switch_guard = if expected_workspace.is_some() {
        Some(state.workspace_switch_lock.lock().await)
    } else {
        None
    };
    let workspace = if let Some(expected) = expected_workspace.as_deref() {
        require_pinned_pdf_workspace(
            &state,
            expected,
            expected_activation.ok_or("rag_delete_path: expected activation is required")?,
            &path,
            "rag_delete_path",
        )
        .await?
    } else {
        require_workspace(&state).await?
    };
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
    expected_workspace: String,
    expected_activation: u64,
) -> Result<u32, String> {
    let _ = page_count;
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    // Fast first check before doing expensive embedding.
    require_pinned_pdf_workspace(
        &state,
        &expected_workspace,
        expected_activation,
        &path,
        "rag_index_pdf_chunks",
    )
    .await?;
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let prepared = pdf_indexer::prepare_pdf_chunks(&path, &pages, page_confidences.as_deref())
        .await
        .map_err(|e| format!("prepare_pdf_chunks: {e:#}"))?;

    // The second check and actual write are one atomic phase with respect to a
    // workspace switch. Slow embedding above never blocks the user from moving.
    let (_switch_guard, workspace) = lock_pinned_pdf_commit(
        &state,
        &expected_workspace,
        expected_activation,
        &path,
        "rag_index_pdf_chunks commit",
    )
    .await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC.
    let count = pdf_indexer::commit_pdf_chunks(
        &table,
        &path,
        prepared,
        &matter,
        &privilege,
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

/// QA-92 / Finding #19 — a searchable PDF needs surviving rows; a PDF with an
/// explicit successful-empty receipt needs zero rows. Old receipts deserialize
/// `empty_index` as false, so a lost legacy index still heals instead of being
/// mistaken for an intentionally empty PDF.
pub(crate) fn pdf_can_skip(
    stat_fresh: bool,
    intentionally_empty: bool,
    rows_present: usize,
) -> bool {
    stat_fresh
        && if intentionally_empty {
            rows_present == 0
        } else {
            rows_present > 0
        }
}

/// Finding #19 — decide the complete PDF work list with one manifest read and
/// one vector-table scan. The former renderer loop called
/// `rag_manifest_pdf_fresh` once per PDF; every call reopened LanceDB, reparsed
/// the whole manifest, and counted rows for one path. On a large workspace that
/// turned a warm restart into an hour-long "Indexing PDFs" pass even though no
/// PDF was actually rebuilt.
///
/// This helper is public for the model-free restart integration test. `paths`
/// are returned unchanged when the saved state cannot be trusted, preserving
/// the existing fail-safe rule: uncertainty causes real re-indexing, never a
/// silent missing result.
pub async fn plan_pdf_index_for_workspace(
    workspace: &Path,
    paths: Vec<String>,
    ocr_enabled: bool,
    integrity_unknown: bool,
    unsafe_tokens: &HashSet<String>,
    key: &[u8; 32],
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if integrity_unknown {
        return Ok(paths);
    }

    let manifest = manifest::load(workspace, store::INDEX_VERSION);
    if manifest.index_version != store::INDEX_VERSION {
        return Ok(paths);
    }

    let conn = store::open_connection(workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table_present = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?
        .iter()
        .any(|name| name == store::TABLE_NAME);
    let row_counts = if table_present {
        let table = conn
            .open_table(store::TABLE_NAME)
            .execute()
            .await
            .map_err(|e| format!("open table: {e}"))?;
        store::scoped_row_counts(&table)
            .await
            .map_err(|e| format!("scan pdf row presence: {e}"))?
    } else {
        // A workspace containing only intentionally-unsearchable PDFs may have
        // no chunks table at all. Empty receipts remain valid with zero rows;
        // normal PDF receipts still fail safe and are selected for healing.
        Default::default()
    };
    let mut total_row_counts = std::collections::HashMap::<String, usize>::new();
    for ((token, _, _), count) in &row_counts {
        *total_row_counts.entry(token.clone()).or_default() += count;
    }
    let pdf_inputs = manifest::PdfInputs::current(ocr_enabled);

    let mut needs_index = Vec::new();
    for path in paths {
        let token = crypto::path_token(key, &path);
        let can_skip = if unsafe_tokens.contains(&token) {
            false
        } else if let (Some((size, mtime)), Some(signature)) = (
            manifest::stat_signature(Path::new(&path)),
            manifest.get(&token),
        ) {
            let intentionally_empty = signature.pdf.as_ref().is_some_and(|pdf| pdf.empty_index);
            let rows_present = if intentionally_empty {
                // Empty means empty across EVERY client/privilege scope. Looking
                // only at the receipt's current scope could hide stale rows that
                // survived under an older client after a failed cleanup.
                total_row_counts.get(&token).copied().unwrap_or(0)
            } else {
                row_counts
                    .get(&(
                        token,
                        signature.matter_id.clone(),
                        signature.privilege.clone(),
                    ))
                    .copied()
                    .unwrap_or(0)
            };
            signature.is_fresh(size, mtime, Some(&pdf_inputs))
                && pdf_can_skip(true, intentionally_empty, rows_present)
        } else {
            false
        };

        if !can_skip {
            needs_index.push(path);
        }
    }
    Ok(needs_index)
}

/// Finding #19 — return only PDFs that genuinely need extraction/indexing.
/// Warm restarts therefore do one bounded check and stay silent when nothing
/// changed, instead of replaying a per-file progress counter from zero.
#[tauri::command]
pub async fn rag_plan_pdf_index(
    state: State<'_, RagState>,
    paths: Vec<String>,
    ocr_enabled: bool,
) -> Result<Vec<String>, String> {
    let workspace = require_workspace(&state).await?;
    if state.index_integrity_unknown.load(Ordering::SeqCst) {
        return Ok(paths);
    }
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let unsafe_tokens = state.unsafe_tokens.lock().await.clone();
    plan_pdf_index_for_workspace(&workspace, paths, ocr_enabled, false, &unsafe_tokens, &key).await
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
    let intentionally_empty = sig.pdf.as_ref().is_some_and(|pdf| pdf.empty_index);
    Ok(pdf_can_skip(true, intentionally_empty, rows))
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
    empty_index: bool,
    expected_workspace: String,
    expected_activation: u64,
) -> Result<(), String> {
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    let (_switch_guard, workspace) = lock_pinned_pdf_commit(
        &state,
        &expected_workspace,
        expected_activation,
        &path,
        "rag_manifest_record_pdf",
    )
    .await?;
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
            empty_index,
        }),
        matter_id: matter,
        privilege,
        meeting_derived: false,
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
    clear_tombstone(&state, &workspace, &path, &key).await;
    Ok(())
}

/// Finding #19 — remove one PDF's completion receipt after a temporary OCR
/// failure. Successfully recovered native-text rows may remain searchable, but
/// without this invalidation an older receipt plus those partial rows would make
/// the next restart skip the failed scanned pages forever.
pub fn forget_pdf_receipt(
    workspace: &Path,
    path: &str,
    key: &[u8; 32],
) -> Result<bool, String> {
    let token = crypto::path_token(key, path);
    let mut m = manifest::load(workspace, store::INDEX_VERSION);
    let is_pdf = m.get(&token).is_some_and(|sig| sig.pdf.is_some());
    if !is_pdf {
        return Ok(false);
    }
    m.remove(&token);
    manifest::save(workspace, &m).map_err(|e| format!("save manifest: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn rag_manifest_forget_pdf(
    state: State<'_, RagState>,
    path: String,
    expected_workspace: String,
    expected_activation: u64,
) -> Result<(), String> {
    let (_switch_guard, workspace) = lock_pinned_pdf_commit(
        &state,
        &expected_workspace,
        expected_activation,
        &path,
        "rag_manifest_forget_pdf",
    )
    .await?;
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;
    let _mg = state.manifest_lock.lock().await;
    match forget_pdf_receipt(&workspace, &path, &key) {
        Ok(_) => Ok(()),
        Err(err) => {
            // If the old receipt cannot be removed, fail closed: hide the
            // partial rows and force a future retry even across a restart.
            let tombstone = tombstone_path(&state, &workspace, &path, &key).await;
            match tombstone {
                Ok(()) => Err(format!("{err}; partial PDF was tombstoned")),
                Err(tombstone_err) => Err(format!(
                    "{err}; tombstone also failed: {tombstone_err:#}"
                )),
            }
        }
    }
}

/// P1.1 (Task 3) — forget ALL PDF manifest entries. Called when the user turns
/// PDF indexing OFF (which deletes every PDF's rows): without this, the stale
/// "fresh" signatures would make a later toggle-ON skip re-indexing PDFs whose
/// rows no longer exist, so they'd silently vanish from search. Text/office
/// entries are untouched.
#[tauri::command]
pub async fn rag_manifest_forget_pdfs(
    state: State<'_, RagState>,
    expected_workspace: String,
    expected_activation: u64,
) -> Result<(), String> {
    let (_switch_guard, workspace) = lock_pinned_pdf_commit(
        &state,
        &expected_workspace,
        expected_activation,
        &expected_workspace,
        "rag_manifest_forget_pdfs",
    )
    .await?;
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

    #[test]
    fn pdf_mutation_pin_rejects_workspace_switch_and_outside_path() {
        let current = Path::new("/workspace/B");
        assert!(validate_pdf_workspace_pin(
            current,
            7,
            "/workspace/B",
            7,
            "/workspace/B/inside.pdf",
            "test",
        )
        .is_ok());
        assert!(validate_pdf_workspace_pin(
            current,
            7,
            "/workspace/A",
            6,
            "/workspace/A/old.pdf",
            "test",
        )
        .unwrap_err()
        .contains("workspace changed"));
        assert!(validate_pdf_workspace_pin(
            current,
            7,
            "/workspace/B",
            7,
            "/workspace/A/outside.pdf",
            "test",
        )
        .unwrap_err()
        .contains("outside"));
    }

    #[test]
    fn pdf_commit_recheck_rejects_an_aba_switch_after_initial_validation() {
        let workspace = Path::new("/workspace/A");
        assert!(validate_pdf_workspace_pin(
            workspace,
            1,
            "/workspace/A",
            1,
            "/workspace/A/slow.pdf",
            "initial check",
        )
        .is_ok());

        // The user opened B, then reopened A while embedding was paused. The
        // path matches again, but activation 3 proves this is a new opening.
        let commit = validate_pdf_workspace_pin(
            workspace,
            3,
            "/workspace/A",
            1,
            "/workspace/A/slow.pdf",
            "commit check",
        );
        assert!(commit.unwrap_err().contains("workspace changed"));
    }

    #[tokio::test]
    async fn pinned_commit_guard_refuses_after_aba_while_slow_work_was_paused() {
        let temp = tempfile::TempDir::new().expect("workspace parent");
        let workspace_a = temp.path().join("A");
        let workspace_b = temp.path().join("B");
        std::fs::create_dir_all(&workspace_a).expect("create A");
        std::fs::create_dir_all(&workspace_b).expect("create B");
        let pdf = workspace_a.join("slow.pdf");
        std::fs::write(&pdf, b"fixture").expect("write PDF");
        let workspace_a_string = workspace_a.to_string_lossy().to_string();
        let pdf_string = pdf.to_string_lossy().to_string();

        let state = RagState::default();
        *state.workspace_root.lock().await = Some(workspace_a.clone());
        state.workspace_activation.store(1, Ordering::SeqCst);
        require_pinned_pdf_workspace(
            &state,
            &workspace_a_string,
            1,
            &pdf_string,
            "initial check",
        )
        .await
        .expect("initial pin");

        // This is the deterministic pause between preparation and commit: B
        // opens, then A opens again before the old prepared rows try to save.
        {
            let _switch = state.workspace_switch_lock.lock().await;
            *state.workspace_root.lock().await = Some(workspace_b);
            state.workspace_activation.store(2, Ordering::SeqCst);
            *state.workspace_root.lock().await = Some(workspace_a.clone());
            state.workspace_activation.store(3, Ordering::SeqCst);
        }

        let commit = lock_pinned_pdf_commit(
            &state,
            &workspace_a_string,
            1,
            &pdf_string,
            "commit check",
        )
        .await;
        match commit {
            Ok(_) => panic!("old A commit must not cross an A → B → A switch"),
            Err(err) => assert!(err.contains("workspace changed")),
        }
    }

    // RED before the fix: the pre-fix path skipped a stat-fresh PDF even with
    // zero surviving rows, leaving it unsearchable forever.
    #[test]
    fn manifest_fresh_pdf_with_zero_rows_must_not_skip() {
        assert!(!pdf_can_skip(true, false, 0));
    }

    // A genuinely-indexed PDF must still skip (no needless re-OCR every boot).
    #[test]
    fn manifest_fresh_pdf_with_rows_may_skip() {
        assert!(pdf_can_skip(true, false, 4));
    }

    // Finding #19: a PDF that was successfully checked but had no safe text to
    // store must not be retried every launch. The explicit receipt separates
    // that outcome from a searchable PDF whose rows were accidentally lost.
    #[test]
    fn manifest_fresh_intentionally_empty_pdf_may_skip_without_rows() {
        assert!(pdf_can_skip(true, true, 0));
        assert!(!pdf_can_skip(true, true, 1));
    }

    // A changed/stale PDF never skips, rows or not.
    #[test]
    fn stale_pdf_never_skips_regardless_of_rows() {
        assert!(!pdf_can_skip(false, false, 10));
        assert!(!pdf_can_skip(false, true, 0));
    }
}
