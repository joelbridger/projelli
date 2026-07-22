use super::*;

/// Walk the active workspace and index every supported file. Emits
/// `rag-indexing-progress` events so the UI can render a banner. Honours
/// `rag_cancel_indexing` mid-walk. Kept as the FULL-walk entry point: scoped
/// re-index (`matter_id = Some`) and explicit full rebuilds. Routine boot now
/// goes through `rag_reconcile_workspace` instead.
#[tauri::command]
pub async fn rag_index_workspace(
    app: AppHandle,
    state: State<'_, RagState>,
    matter_id: Option<String>,
) -> Result<(), String> {
    run_workspace_index(app, state, matter_id, IndexMode::Full).await
}

/// P1.1 (Task 4) — the boot indexing command. Cheap stat-walk of the workspace,
/// then (re)index ONLY new/changed files, purge rows for deleted files, and skip
/// everything whose signature is unchanged in the persistent manifest. Falls back
/// to a full rebuild automatically when a schema migration or a fail-closed
/// integrity-unknown state requires it. Replaces `rag_index_workspace` as the
/// per-open indexer so a warm boot no longer re-embeds the whole workspace.
#[tauri::command]
pub async fn rag_reconcile_workspace(
    app: AppHandle,
    state: State<'_, RagState>,
    matter_id: Option<String>,
) -> Result<(), String> {
    run_workspace_index(app, state, matter_id, IndexMode::Reconcile).await
}

/// Below this many purgeable manifest entries the mass-deletion sanity breaker
/// stays disarmed: on a tiny workspace a high deleted ratio is normal (deleting
/// 2 of 3 test files), so only a non-trivially-sized manifest can trip it.
pub(crate) const PURGE_BREAKER_FLOOR: usize = 16;

/// N consecutive `delete_by_token` failures in the purge loop before it ABORTS.
/// Every failing delete still scans the whole LanceDB table, so a broken delete
/// path that keeps failing is a self-perpetuating flood that grinds for minutes
/// and starves the shared table / async runtime (the observed pass-2 systemic
/// failure). A single success resets the counter, so a few genuinely-unpurgeable
/// files among many good ones never trip it.
pub(crate) const MAX_CONSECUTIVE_DELETE_FAILURES: u32 = 8;

/// Mass-deletion sanity breaker. Returns true when the deleted-source purge set
/// looks catastrophic — more than half of a non-trivially-sized purgeable
/// manifest — and must therefore be SKIPPED rather than executed.
///
/// A workspace does not lose half its indexed files between two boots without
/// deliberate human action. A signal that says so is far more likely a
/// token-format / path-form mismatch making the whole manifest look deleted (the
/// boot-reconcile delete-flood this change hardens against) than a real
/// deletion. Purging on that false signal both floods the store AND could wrongly
/// drop real content, so we refuse and mark the reconcile degraded instead. Pure
/// + unit-tested.
pub(crate) fn purge_looks_catastrophic(deleted: usize, purgeable_total: usize) -> bool {
    purgeable_total >= PURGE_BREAKER_FLOOR && deleted * 2 > purgeable_total
}

/// Consecutive-failure backoff for the deleted-source purge loop. `on_failure`
/// returns true once [`MAX_CONSECUTIVE_DELETE_FAILURES`] back-to-back failures
/// are reached (the loop should then abort); any success resets the run.
#[derive(Default)]
pub(crate) struct DeleteBackoff {
    consecutive: u32,
}

impl DeleteBackoff {
    fn on_success(&mut self) {
        self.consecutive = 0;
    }
    /// Record a failure; returns true when the abort threshold has been reached.
    fn on_failure(&mut self) -> bool {
        self.consecutive += 1;
        self.consecutive >= MAX_CONSECUTIVE_DELETE_FAILURES
    }
}

/// Compute the deleted-source purge set: manifest entries whose file is no longer
/// present on disk this walk. A key qualifies iff it is a NON-PDF source (PDF
/// lifecycle is frontend-owned; `mail:`/connector rows are never in the manifest)
/// AND its token is absent from `disk_keys` (the path tokens of the files the walk
/// actually found). Pure, so the cross-slash-form Windows regression — a manifest
/// keyed under one path form vs. a disk walk computing tokens under another — is
/// unit-testable without a live store.
pub(crate) fn compute_deleted_keys(
    manifest_sources: &std::collections::BTreeMap<String, manifest::SourceSignature>,
    disk_keys: &std::collections::HashSet<String>,
) -> Vec<String> {
    manifest_sources
        .iter()
        .filter(|(k, sig)| sig.pdf.is_none() && !disk_keys.contains(*k))
        .map(|(k, _)| k.clone())
        .collect()
}

/// Preserve a durable privacy receipt when a file is known from existing rows
/// to be meeting-derived but its exact sibling manifest is missing or corrupt.
/// A zero-row signature deliberately records "checked and purged": the next
/// reconcile still knows this is meeting material and can never downgrade it to
/// an ordinary document merely because the purged rows are now gone.
fn protected_meeting_receipt(
    file: &Path,
    matter: &str,
    privilege: &str,
    prior: Option<&manifest::SourceSignature>,
) -> Option<manifest::SourceSignature> {
    if let Some(prior) = prior {
        let mut retained = prior.clone();
        retained.meeting_derived = true;
        retained.row_count = 0;
        return Some(retained);
    }
    text_source_signature(file, matter, privilege, 0, true)
}

/// Durably record a rebuild-required the instant a stale-key-format manifest is
/// first observed on workspace open — BEFORE any incremental manifest writer runs.
///
/// Why this is necessary: bumping `MANIFEST_VERSION` makes `manifest::load` treat
/// an older on-disk manifest as empty and `manifest::save` then writes it forward
/// to the CURRENT version. So a pre-reconcile incremental write (a PDF-record via
/// `rag_manifest_record_pdf`, or a watcher-driven single-file index) would upgrade
/// the file to the current version and erase the `has_stale_key_format` signal
/// before the boot reconcile ever checks it — skipping the drop+rebuild and
/// leaving deleted-while-closed files' rows searchable. Setting the durable
/// `rebuild_required` sentinel here makes the signal survive any later write:
/// every manifest writer requires the workspace to be set first (`require_workspace`),
/// and `rag_set_workspace` is where this runs, so it always wins the race.
pub(crate) fn mark_rebuild_if_manifest_stale(workspace: &Path) {
    if manifest::has_stale_key_format(workspace) {
        log::info!(
            "rag: stale-format manifest observed on open — marking rebuild-required \
             so a later incremental write can't erase the migration signal"
        );
        store::mark_rebuild_required(workspace);
    }
}

/// The reconcile must DROP the table and rebuild from scratch — not merely do a
/// full WALK — whenever a schema migration, a manifest key-format upgrade, or a
/// degraded-purge recovery is pending. A full walk re-indexes present files but
/// never removes rows for files that vanished while closed; only a drop clears
/// those. Getting `rebuild_required` into this set is the fix for the
/// degraded-purge content leak: after the breaker/backoff skips the purge, a full
/// walk alone would leave the un-purged deleted rows live AND then clear the
/// fail-closed flag, resurfacing deleted content. Pure + unit-tested.
pub(crate) fn needs_drop_and_rebuild(
    migrating: bool,
    stale_key_format: bool,
    rebuild_required: bool,
) -> bool {
    migrating || stale_key_format || rebuild_required
}

pub(crate) fn mark_mail_backfill_needed_after_vector_rebuild(workspace: &Path, reason: &str) {
    if !crate::commands::mail::store::EncryptedMailStore::db_path(workspace).exists() {
        return;
    }
    let key = match crate::commands::mail::crypto::get_or_create_master_key() {
        Ok(key) => key,
        Err(e) => {
            log::warn!(
                "rag: failed to load mail key after vector rebuild ({reason}); \
                 mail RAG backfill marker not set: {e:#}"
            );
            return;
        }
    };
    match crate::commands::mail::mark_rag_backfill_needed_after_vector_rebuild(workspace, &key) {
        Ok(true) => {
            log::info!("rag: marked mail RAG backfill needed after vector rebuild ({reason})");
        }
        Ok(false) => {}
        Err(e) => {
            log::warn!(
                "rag: failed to mark mail RAG backfill after vector rebuild ({reason}): {e:#}"
            );
        }
    }
}

/// QA-92 — given a stat-fresh manifest entry, its path token, and the per-scope
/// row counts pre-scanned from the live table, decide whether a boot reconcile
/// may SKIP the file. The manifest is only a receipt: a file can look "already
/// indexed" on paper while its actual vector rows are gone — a partial prior
/// index, a lost/rebuilt vectors cache, or a retag that flipped the recorded
/// scope without moving rows. Skipping such a file leaves a pre-existing file
/// silently unsearchable forever (the QA-92 demo blocker). Skip ONLY when the
/// entry claims a non-zero row count AND at least that many rows actually exist
/// under the entry's RECORDED scope; otherwise re-index.
///
/// `row_count == 0` is treated as "unknown, not trusted" — mirrors the
/// single-file fast-path guard `path_has_expected_rows_for_scope`. Pure so the
/// decision is unit-tested without a live store.
pub(crate) fn reconcile_skip_is_row_backed(
    entry: &manifest::SourceSignature,
    token: &str,
    scoped_counts: &std::collections::HashMap<(String, String, String), usize>,
) -> bool {
    // A receipt that recorded 0 rows can't prove anything is searchable (legacy
    // single-file writes stored 0 for non-empty files) — re-index to be sure.
    if entry.row_count == 0 {
        return false;
    }
    let present = scoped_counts
        .get(&(
            token.to_string(),
            entry.matter_id.clone(),
            entry.privilege.clone(),
        ))
        .copied()
        .unwrap_or(0);
    present >= entry.row_count as usize
}

/// P1.1 — shared engine behind `rag_index_workspace` (Full) and
/// `rag_reconcile_workspace` (Reconcile). See `IndexMode`.
pub(crate) async fn run_workspace_index(
    app: AppHandle,
    state: State<'_, RagState>,
    matter_id: Option<String>,
    mode: IndexMode,
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

    // A DEFAULT walk just consumed the once-per-activation latch (set it false). If
    // setup below bails with an error (e.g. a transient lock on the forced-rebuild
    // drop_table) before `finalize_walk` runs, re-arm the latch so a later reconcile
    // in this SAME activation retries — otherwise a fail-closed / rebuild-pending
    // index couldn't recover until an app/workspace restart. Disarmed once setup
    // succeeds, handing the latch decision to `finalize_walk`. (A SCOPED walk never
    // consumed the latch, so it gets no guard.)
    let mut relatch =
        matter_id.is_none().then(|| RelatchGuard::new(state.full_index_pending.clone()));

    state.cancel_flag.store(false, Ordering::SeqCst);
    let cancel = state.cancel_flag.clone();

    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;

    // WS-B/C migration: a pre-3.0 table has rows without the NON-NULL matter_id
    // column. We never back-fill null (a null matter is a confidentiality
    // hazard) — instead drop the old table and re-index from scratch, which the
    // walk below does anyway. Idempotent + version-gated so it runs at most once.
    //
    // P1.1 (Task 2) — schema migration is SEPARATE from routine boot reconcile.
    // When `migrating` is true, this is a one-time SCHEMA rebuild: it forces a
    // full walk (below), the stale manifest is dropped so its old-schema
    // signatures can't wrongly skip files, and the banner reports an honest
    // "Upgrading search index…" (via the `migrating` progress flag). A routine
    // boot has `migrating == false` and does the cheap reconcile.
    let migrating = store::needs_migration(&conn, &workspace)
        .await
        .map_err(|e| format!("migration check: {e}"))?;
    // P1.1 — a manifest whose KEY FORMAT predates v2 (keyed by plaintext paths, not
    // HMAC tokens) can't be matched against the token-keyed rows, so deletions
    // can't be computed from it. Discarding it while the table survives would leave
    // a deleted-while-closed file's rows searchable. Rebuild the store from scratch
    // instead (drop + full reindex), which purges every stale/deleted row.
    let stale_key_format = manifest::has_stale_key_format(&workspace);
    // A prior boot's deleted-source purge was DEGRADED (sanity breaker refused it
    // or the backoff aborted it), leaving deleted-file rows un-purged AND
    // un-tombstoned. A full WALK alone would re-index present files but never drop
    // those orphaned rows and would then wrongly clear the fail-closed flag —
    // resurfacing deleted content. So a durable rebuild-required sentinel forces a
    // clean drop + full re-index here, exactly like a key-format upgrade. (Cleared
    // only after this walk completes cleanly — see `finalize_walk`.)
    let rebuild_required = store::is_rebuild_required(&workspace);
    // P2.1 (Finding 4): a destructive rebuild deletes and recreates the dataset,
    // which the cached handle's read-consistency re-check can't recover from.
    // Drop the cache BEFORE the drop so a concurrent Ask/verify can't keep using
    // the handle to the dataset being purged, and AGAIN after so any handle a read
    // re-cached in the tiny pre-drop window is cleared (the next read then re-opens
    // the freshly recreated table, which read-consistency fills in as rows land).
    let dropped_vector_store =
        needs_drop_and_rebuild(migrating, stale_key_format, rebuild_required);
    if dropped_vector_store {
        invalidate_table_cache(&state).await;
        let reason = if migrating {
            format!("schema migration to v{}", store::INDEX_VERSION)
        } else if stale_key_format {
            "manifest key-format upgrade (v1/v2→current)".to_string()
        } else {
            "degraded-purge recovery".to_string()
        };
        log::info!("rag: rebuilding vector store from scratch ({reason})");
        store::drop_table(&conn)
            .await
            .map_err(|e| format!("drop table for {reason}: {e}"))?;
        mark_mail_backfill_needed_after_vector_rebuild(&workspace, &reason);
        manifest::delete(&workspace);
        invalidate_table_cache(&state).await;
    }

    // P1.1 — a fail-closed integrity-unknown state (a durable tombstone write
    // failed on a prior run) is only cleared by a CLEAN FULL walk that rewrites
    // the tombstone file. A reconcile skips files and would never clear it, so it
    // must escalate to a full walk. Check both the in-process flag and the durable
    // cross-process sentinel.
    let integrity_unknown = state.index_integrity_unknown.load(Ordering::SeqCst)
        || store::read_unsafe_tokens(&workspace).is_integrity_unknown();

    // P1.1 — if the manifest survives but the LanceDB `chunks` table is ABSENT
    // (the vectors cache was deleted / corrupted / never built), the store holds
    // no rows, so trusting the manifest would "reuse" everything and leave search
    // empty. `open_or_create_table` (below) would happily create a fresh empty
    // table. Detect the absence FIRST and force a full rebuild.
    let table_missing = !conn
        .table_names()
        .execute()
        .await
        .map_err(|e| format!("list tables: {e}"))?
        .iter()
        .any(|n| n == store::TABLE_NAME);

    // A migration, a manifest key-format upgrade, a fail-closed recovery, or a
    // missing vector table forces a full walk regardless of the requested mode.
    let effective_full = matches!(mode, IndexMode::Full)
        || migrating
        || stale_key_format
        || rebuild_required
        || integrity_unknown
        || table_missing;

    // If the vector table is missing, the store holds NO rows — so EVERY manifest
    // signature (text/office AND pdf) is stale. Drop the whole manifest so the
    // text/office rebuild below isn't skipped AND the frontend PDF fresh-check
    // (which would otherwise see retained pdf entries as "fresh") re-indexes PDFs
    // too. (The migration path already deletes it above.)
    if table_missing {
        if !dropped_vector_store {
            mark_mail_backfill_needed_after_vector_rebuild(&workspace, "missing vector table");
        }
        manifest::delete(&workspace);
    }

    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // WS-VEC: the vector-store master key — chunk text is encrypted at rest.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;

    // Setup succeeded — every error path that could strand the latch is behind us
    // (Phase 1/2 don't return Err; a mid-walk cancel returns Ok and intentionally
    // leaves the latch consumed). Hand the latch decision to `finalize_walk`.
    if let Some(g) = relatch.as_mut() {
        g.disarm();
    }

    // VG-6d: try to load the workspace vault master key once for the whole walk.
    // Returns None if the workspace is not vaulted or the vault is locked —
    // in which case indexing proceeds on plaintext files unchanged. The VMK is
    // held for the duration of the walk and zeroized on drop (ZeroizedVmk).
    let vault_vmk_holder = crate::commands::vault::try_load_vault_vmk(&workspace);
    let vault_vmk: Option<[u8; 32]> = vault_vmk_holder.as_ref().map(|v| *v.as_bytes());

    // ── Phase 1: enumerate the workspace + build the work list ──────────────
    //
    // Both modes stat-walk the whole tree (cheap: a directory traversal + one
    // `metadata()` per file — no reads, extraction, or embedding). A Full walk
    // then processes every file; a Reconcile walk processes only new/changed
    // files and skips the rest, comparing each against the persistent manifest.
    let walk_started = Instant::now();

    // Reconcile surfaces the "checking files" phase distinctly from "indexing
    // changed files" (Task 4) so the banner can say "Checking files…".
    if !effective_full {
        let _ = app.emit(
            PROGRESS_EVENT,
            IndexingProgress {
                status: IndexingStatus::Checking,
                processed: 0,
                total: 0,
                current_path: None,
                ..Default::default()
            },
        );
    }

    let all_files: Vec<PathBuf> = walkdir::WalkDir::new(&workspace)
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

    // The manifest is authoritative for "have we already indexed this exact file
    // version, and under what scope". A Full walk starts from empty (it rebuilds
    // the text/office portion from scratch); a Reconcile loads the durable one. A
    // missing/corrupt manifest loads empty → every file looks new → we re-index
    // everything (correct, just not faster).
    let durable_manifest = manifest::load(&workspace, store::INDEX_VERSION);
    let mut manifest = if effective_full {
        manifest::Manifest::new(store::INDEX_VERSION)
    } else {
        durable_manifest.clone()
    };
    manifest.index_version = store::INDEX_VERSION;

    // Normalized paths present on disk this walk (used to purge deleted files).
    // P1.1 — the manifest is keyed by each source's HMAC PATH TOKEN, NOT its
    // plaintext path: (a) VG-6e privacy parity — no client/matter file map is
    // written to disk in plaintext (the `.lantern` manifest would otherwise
    // reintroduce exactly what tokenizing the `path` column removed); and (b) the
    // token matches the value the LanceDB rows are keyed under (`path_token` over
    // the SAME path string the rows were written with — un-normalized), so the
    // deleted-file purge and the tombstoned-file check hit the right rows on every
    // platform, including Windows where the stored token is over a backslash path.
    let disk_keys: std::collections::HashSet<String> = all_files
        .iter()
        .map(|p| crypto::path_token(&key, &p.to_string_lossy()))
        .collect();

    // A file to (re)index, plus the scope to write its rows under.
    struct WorkItem {
        file: PathBuf,
        matter: String,
        privilege: String,
        meeting_derived: bool,
    }
    let mut work: Vec<WorkItem> = Vec::new();
    let mut reused: u32 = 0;
    // The text/office manifest entries this walk will persist: reused files carry
    // their existing fresh signature forward; (re)indexed files get a fresh one.
    let mut next_sources: std::collections::BTreeMap<String, manifest::SourceSignature> =
        std::collections::BTreeMap::new();

    // QA-92: pre-scan the live table ONCE so every SKIP below can PROVE its rows
    // still exist under the recorded scope in O(1) — a manifest "fresh" receipt
    // whose vector rows are missing (partial prior index, lost/rebuilt cache, or
    // a retag that flipped the recorded scope without moving rows) must NOT be
    // skipped, or the pre-existing file stays permanently unsearchable. Only a
    // reconcile skips files (a full walk re-indexes everything), so the scan is
    // needless there. If the scan itself fails, an empty map makes every skip
    // look unproven → re-index — the correct fail-safe (never skip a stale file).
    let scoped_counts: std::collections::HashMap<(String, String, String), usize> =
        if effective_full {
            std::collections::HashMap::new()
        } else {
            store::scoped_row_counts(&table).await.unwrap_or_else(|e| {
                log::warn!(
                    "rag reconcile: scoped_row_counts failed ({e:#}); treating all \
                     skips as unproven → re-index (fail safe)"
                );
                std::collections::HashMap::new()
            })
        };
    // The row-level source type is a second durable privacy receipt. It repairs
    // a missing/corrupt freshness manifest instead of allowing a full walk to
    // downgrade a previously protected meeting file to ordinary text.
    let meeting_source_tokens = store::meeting_source_tokens(&table)
        .await
        .map_err(|e| format!("read durable meeting provenance before reconcile: {e:#}"))?;

    for file in &all_files {
        if effective_full {
            // Full walk: (re)index everything under the workspace-default scope
            // (the caller's `matter` — UNASSIGNED for the default None, or a real
            // id for a scoped rebuild — at PRIVILEGE_NONE). Per-file privilege /
            // matter is re-tagged afterward by the frontend, as it always has been.
            work.push(WorkItem {
                file: file.clone(),
                matter: matter.clone(),
                privilege: store::PRIVILEGE_NONE.to_string(),
                meeting_derived: {
                    let token = crypto::path_token(&key, &file.to_string_lossy());
                    durable_manifest
                        .get(&token)
                        .is_some_and(|entry| entry.meeting_derived)
                        || meeting_source_tokens.contains(&token)
                },
            });
            continue;
        }
        // Reconcile: the pure `decide_file` decision. Skip an unchanged,
        // non-tombstoned file; otherwise re-index — a tombstoned file to clear its
        // tombstone, a changed file under its RECORDED scope (never widened). The
        // manifest key is the source's path token (matches the stored rows, and
        // keeps no plaintext path on disk).
        let token = crypto::path_token(&key, &file.to_string_lossy());
        let tombstoned = state.unsafe_tokens.lock().await.contains(&token);
        match manifest::decide_file(
            manifest.get(&token),
            manifest::stat_signature(file),
            tombstoned,
        ) {
            manifest::FileDecision::Skip => match manifest.get(&token) {
                Some(entry) if reconcile_skip_is_row_backed(entry, &token, &scoped_counts) => {
                    let mut retained = entry.clone();
                    retained.meeting_derived = retained.meeting_derived
                        || meeting_source_tokens.contains(&token);
                    next_sources.insert(token, retained);
                    reused += 1;
                }
                Some(entry) => {
                    // QA-92: stat-fresh, but its vector rows are missing/short
                    // under the recorded scope — re-index under that SAME scope
                    // (never widened) so the pre-existing file becomes searchable.
                    work.push(WorkItem {
                        file: file.clone(),
                        matter: entry.matter_id.clone(),
                        privilege: entry.privilege.clone(),
                        meeting_derived: entry.meeting_derived
                            || meeting_source_tokens.contains(&token),
                    });
                }
                None => {
                    // decide_file only returns Skip for a present entry; re-index
                    // defensively rather than skip a file we can't prove is indexed.
                    work.push(WorkItem {
                        file: file.clone(),
                        matter: store::UNASSIGNED_MATTER.to_string(),
                        privilege: store::PRIVILEGE_NONE.to_string(),
                        meeting_derived: meeting_source_tokens.contains(&token),
                    });
                }
            },
            manifest::FileDecision::Reindex { prior_scope } => {
                let (m, p) = prior_scope.unwrap_or_else(|| {
                    (
                        store::UNASSIGNED_MATTER.to_string(),
                        store::PRIVILEGE_NONE.to_string(),
                    )
                });
                work.push(WorkItem {
                    file: file.clone(),
                    matter: m,
                    privilege: p,
                    meeting_derived: manifest
                        .get(&token)
                        .is_some_and(|entry| entry.meeting_derived)
                        || meeting_source_tokens.contains(&token),
                });
            }
        }
    }

    // Deleted sources: manifest text/office entries whose file is gone from disk.
    // PDF entries are preserved (the Rust walk doesn't see PDFs; the frontend owns
    // their lifecycle). `mail:` / connector rows are never in the manifest, so are
    // never touched here.
    let deleted_keys: Vec<String> = compute_deleted_keys(&manifest.sources, &disk_keys);
    // Declared before the deleted-purge loop so a fail-closed tombstone on a
    // failed purge (below) is recorded in the same tally the walk finalizes with.
    let mut tally = IndexTally::default();
    let mut deleted: u32 = 0;

    // ── Flood-proofing (defense in depth, independent of the root cause) ────
    // The purgeable manifest = the entries this purge could ever touch (non-PDF
    // sources). If the "deleted" set is more than half of that, treat it as a
    // suspected mass-deletion FALSE ALARM (a token/path-form mismatch making the
    // whole workspace look deleted), NOT a real deletion — a workspace does not
    // shed half its files between boots without human action.
    let purgeable_total = manifest
        .sources
        .values()
        .filter(|sig| sig.pdf.is_none())
        .count();
    if purge_looks_catastrophic(deleted_keys.len(), purgeable_total) {
        // Do NOT purge. Log loudly and mark the reconcile degraded. Two durable
        // sentinels drive recovery: integrity-unknown makes retrieval/verify fail
        // closed until recovery; rebuild-required forces the NEXT boot to do a
        // clean drop_table + full re-index (a full WALK alone would re-index
        // present files but leave the un-purged deleted rows live and then wrongly
        // clear the fail-closed flag). `purge_degraded` also stops THIS walk from
        // stamping completion, so the recovery actually runs next launch.
        log::error!(
            "rag reconcile: SANITY BREAKER — {} of {} indexed files look deleted \
             (> 50%). Refusing to mass-purge (almost certainly a token/path-form \
             mismatch, not a real deletion); marking the index degraded for a \
             clean rebuild on next launch.",
            deleted_keys.len(),
            purgeable_total,
        );
        store::mark_integrity_unknown(&workspace);
        store::mark_rebuild_required(&workspace);
        state.index_integrity_unknown.store(true, Ordering::SeqCst);
        tally.purge_degraded = true;
    } else {
        // Consecutive-failure backoff: if the delete path is broken, every failing
        // delete still scans the whole table — a self-perpetuating flood. Abort the
        // loop after N back-to-back failures so it can't grind for minutes and
        // starve the shared LanceDB table / async runtime.
        let mut backoff = DeleteBackoff::default();
        for gone in &deleted_keys {
            // `gone` is the source's HMAC path token — delete/tombstone BY TOKEN,
            // since the plaintext path is gone from disk and the token is what the
            // rows and the tombstone set are keyed under.
            match store::delete_by_token(&table, gone).await {
                Ok(()) => {
                    backoff.on_success();
                    clear_tombstone_token(&state, &workspace, gone).await;
                    deleted += 1;
                }
                Err(e) => {
                    // FAIL CLOSED: the file is gone from disk but its rows could not
                    // be purged. A deleted file's content must never remain citable,
                    // so durably tombstone the token (retrieval + verification
                    // exclude it) until a later boot successfully purges it. If the
                    // durable persist ALSO fails, mark the walk so it does not stamp
                    // completion (next launch re-runs). Keep the manifest entry so
                    // the purge is retried.
                    log::error!(
                        "rag reconcile: failed to purge rows for a deleted source; \
                         tombstoning so its content cannot resurface in search: {e:#}"
                    );
                    if tombstone_token(&state, &workspace, gone.clone()).await.is_err() {
                        tally.durable_tombstone_failed = true;
                    }
                    if let Some(sig) = manifest.get(gone) {
                        next_sources.insert(gone.clone(), sig.clone());
                    }
                    if backoff.on_failure() {
                        // Too many back-to-back failures — the delete path is broken.
                        // Stop the flood. Mark the index degraded + integrity-unknown
                        // so retrieval fails closed and next boot does a clean rebuild
                        // rather than replaying this loop. Remaining deleted_keys keep
                        // their manifest entries (never purged, so retried next boot).
                        log::error!(
                            "rag reconcile: DELETE BACKOFF — {} consecutive delete \
                             failures; aborting the purge loop to avoid a runaway \
                             flood. Marking the index degraded for a clean rebuild \
                             on next launch.",
                            MAX_CONSECUTIVE_DELETE_FAILURES,
                        );
                        store::mark_integrity_unknown(&workspace);
                        store::mark_rebuild_required(&workspace);
                        state.index_integrity_unknown.store(true, Ordering::SeqCst);
                        tally.purge_degraded = true;
                        break;
                    }
                }
            }
        }
    }

    // ── Phase 2: (re)index the work list ────────────────────────────────────
    let total = work.len() as u32;
    let _ = app.emit(
        PROGRESS_EVENT,
        IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: 0,
            total,
            current_path: None,
            migrating,
            reused,
            ..Default::default()
        },
    );

    let mut reindexed: u32 = 0;
    for (i, item) in work.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                PROGRESS_EVENT,
                IndexingProgress {
                    status: IndexingStatus::Cancelled,
                    processed: i as u32,
                    total,
                    current_path: None,
                    skipped: tally.skipped_files,
                    failed: tally.failed_files,
                    timed_out: tally.timed_out_files,
                    cleanup_failed: tally.cleanup_failed_files,
                    skipped_paths: cap_skipped_paths(&tally.skipped_paths),
                    reused,
                    reindexed,
                    deleted,
                    ..Default::default()
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
                current_path: Some(item.file.to_string_lossy().to_string()),
                skipped: tally.skipped_files,
                failed: tally.failed_files,
                timed_out: tally.timed_out_files,
                migrating,
                reused,
                ..Default::default()
            },
        );
        // Manifest key = the source's path token (matches the rows; no plaintext).
        let token = crypto::path_token(&key, &item.file.to_string_lossy());
        match process_one_workspace_file(
            &app,
            &state,
            &table,
            &workspace,
            &item.file,
            &item.matter,
            &item.privilege,
            item.meeting_derived,
            &key,
            vault_vmk,
            &cancel,
            i as u32,
            total,
            &mut tally,
        )
        .await
        {
            FileProcess::CancelledMidFile => {
                // Nothing written; the next cancel check ends the walk.
            }
            FileProcess::Recorded(rc) => {
                reindexed += 1;
                if let Some(sig) =
                    text_source_signature(
                        &item.file,
                        &item.matter,
                        &item.privilege,
                        rc,
                        item.meeting_derived || exact_meeting_manifest_names_file(&item.file),
                    )
                {
                    next_sources.insert(token, sig);
                }
            }
            FileProcess::ProtectedMeetingMissingManifest => {
                if let Some(signature) = protected_meeting_receipt(
                    &item.file,
                    &item.matter,
                    &item.privilege,
                    durable_manifest.get(&token),
                ) {
                    next_sources.insert(token, signature);
                }
            }
            FileProcess::NotRecorded => {
                // Attempted but failed/unreadable — record no signature so it is
                // retried (never wrongly skipped) next boot. NOT counted in
                // `reindexed` (it counts successful re-indexes only); the failure is
                // already reflected in the tally's skipped/failed counters.
            }
        }
    }

    // ── Persist the manifest (merge with any concurrent PDF entries) ────────
    // Reload under the lock, KEEP on-disk PDF signatures (the frontend PDF-index
    // path writes those concurrently), replace the text/office portion with this
    // walk's authoritative result, then save. Holding the lock across
    // reload+save serializes with `rag_manifest_record_pdf`.
    // Only the DEFAULT walk (matter_id None — reconcile, or a full rebuild on
    // migration / integrity recovery) is authoritative for the manifest. A SCOPED
    // full walk (`matter_id = Some`) files every file under one matter as a
    // deliberate re-tag; persisting that whole-workspace-under-one-matter scope
    // would let a later reconcile preserve the mis-scope, so it leaves the manifest
    // untouched. (No frontend path issues a scoped whole-workspace walk today; this
    // guard keeps it correct if one is ever added.)
    if matter_id.is_none() {
        // Normally we drop the purged keys from the manifest. But when the purge was
        // DEGRADED (breaker skipped it, or backoff aborted mid-loop), the keys we did
        // NOT purge must be PRESERVED so a later boot retries the purge — dropping
        // them would orphan their rows AND lose the retry marker. Preserving an
        // already-purged key is harmless (next boot's delete is a no-op), so on a
        // degraded walk we drop nothing on account of deletion.
        let deleted_set: std::collections::HashSet<&String> = if tally.purge_degraded {
            std::collections::HashSet::new()
        } else {
            deleted_keys.iter().collect()
        };
        let _mg = state.manifest_lock.lock().await;
        let mut on_disk = manifest::load(&workspace, store::INDEX_VERSION);
        on_disk.index_version = store::INDEX_VERSION;
        // Keep entries this walk is NOT authoritative for, then apply this walk's
        // result. "Authoritative for" = a text/office file that was in this walk's
        // on-disk snapshot (`disk_keys`) or that this walk purged (`deleted_set`).
        // Everything else — PDF entries (frontend-owned) and text entries a watcher
        // wrote for a file created AFTER the phase-1 snapshot — is preserved, so a
        // concurrent single-file index during the walk is never clobbered.
        on_disk.sources.retain(|k, sig| {
            sig.pdf.is_some() || (!disk_keys.contains(k) && !deleted_set.contains(k))
        });
        for (k, sig) in &next_sources {
            on_disk.sources.insert(k.clone(), sig.clone());
        }
        if let Err(e) = manifest::save(&workspace, &on_disk) {
            log::warn!("rag reconcile: failed to save manifest: {e}");
        }
    }

    // ── Completion / fail-closed rules + terminal event ─────────────────────
    finalize_walk(
        &app,
        &state,
        &workspace,
        effective_full,
        total,
        &tally,
        reused,
        reindexed,
        deleted,
    )
    .await;

    log::info!(
        "rag {}: DONE work={} reused={} reindexed={} deleted={} in {} ms (skipped={}, failed={}, timed_out={}, cleanup_failed={})",
        if effective_full { "index_workspace" } else { "reconcile" },
        total,
        reused,
        reindexed,
        deleted,
        walk_started.elapsed().as_millis(),
        tally.skipped_files,
        tally.failed_files,
        tally.timed_out_files,
        tally.cleanup_failed_files,
    );
    Ok(())
}


#[cfg(test)]
mod flood_proofing_tests {
    use super::*;
    use crate::commands::rag::crypto::path_token;
    use crate::commands::rag::manifest::{PdfSignature, SourceSignature};
    use std::collections::{BTreeMap, HashSet};

    const KEY: [u8; 32] = [0x33u8; 32];

    fn text_sig() -> SourceSignature {
        SourceSignature {
            size: 100,
            mtime_ns: 42,
            hash: None,
            extractor_version: 0,
            chunker_version: 0,
            embedder_version: String::new(),
            pdf: None,
            matter_id: "unassigned".into(),
            privilege: "none".into(),
            meeting_derived: false,
            row_count: 3,
            indexed_at: 0,
        }
    }

    fn pdf_sig() -> SourceSignature {
        SourceSignature {
            pdf: Some(PdfSignature {
                pdf_extractor_version: 1,
                ocr_enabled: false,
                ocr_version: 1,
                page_count: 2,
                empty_index: false,
            }),
            ..text_sig()
        }
    }

    #[test]
    fn missing_manifest_meeting_receipt_survives_two_reconciles_without_rows() {
        let path = std::env::temp_dir().join(format!(
            "lantern-meeting-receipt-{}-{}.txt",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, b"private meeting transcript").unwrap();

        // First reconcile: the freshness manifest is absent, but a durable row
        // says this was meeting-derived. Purging that row must synthesize a
        // zero-row receipt rather than forgetting the lineage with the row.
        let first = protected_meeting_receipt(
            &path,
            "matter-private",
            "none",
            None,
        )
        .expect("a present protected file gets a durable receipt");
        assert!(first.meeting_derived);
        assert_eq!(first.row_count, 0);

        // Second reconcile: no rows remain to rediscover provenance. The first
        // receipt alone must keep the file protected and zero-row.
        let second = protected_meeting_receipt(
            &path,
            "matter-private",
            "none",
            Some(&first),
        )
        .expect("the prior synthetic receipt is retained");
        assert!(second.meeting_derived);
        assert_eq!(second.row_count, 0);

        let _ = std::fs::remove_file(path);
    }

    // ── Root-cause regression: the cross-slash-form Windows token bug ───────
    // A manifest written on a prior boot from the NATIVE backslash path (what
    // WalkDir yields on Windows) must NOT make the file look deleted when THIS
    // boot's disk walk sees the same file via the forward-slash form. Before the
    // `path_token` normalizer, the two forms tokenized differently, so the disk
    // token missed the manifest key and EVERY file looked deleted — the reconcile
    // delete-flood. This goes red if normalization is ever removed.
    #[test]
    fn cross_slash_form_present_file_is_not_seen_as_deleted() {
        let manifest_key = path_token(&KEY, r"C:\WS\Clients\Acme\a.docx");
        let mut sources = BTreeMap::new();
        sources.insert(manifest_key, text_sig());
        let disk_keys: HashSet<String> = [path_token(&KEY, "C:/WS/Clients/Acme/a.docx")]
            .into_iter()
            .collect();
        assert!(
            compute_deleted_keys(&sources, &disk_keys).is_empty(),
            "a present file seen via a different slash form must not look deleted"
        );
    }

    #[test]
    fn genuinely_absent_file_is_purged_present_is_kept() {
        let gone = path_token(&KEY, "/ws/gone.docx");
        let present = path_token(&KEY, "/ws/present.docx");
        let mut sources = BTreeMap::new();
        sources.insert(gone.clone(), text_sig());
        sources.insert(present.clone(), text_sig());
        let disk_keys: HashSet<String> = [present].into_iter().collect();
        assert_eq!(
            compute_deleted_keys(&sources, &disk_keys),
            vec![gone],
            "a real deletion must still be purged"
        );
    }

    #[test]
    fn pdf_entries_are_never_in_the_deleted_set() {
        let pdf = path_token(&KEY, "/ws/report.pdf");
        let mut sources = BTreeMap::new();
        sources.insert(pdf, pdf_sig());
        assert!(
            compute_deleted_keys(&sources, &HashSet::new()).is_empty(),
            "PDF lifecycle is frontend-owned; PDF entries are never purged here"
        );
    }

    // ── Defense in depth: the mass-deletion sanity breaker ─────────────────
    #[test]
    fn breaker_trips_strictly_above_half_on_a_nontrivial_manifest() {
        assert!(purge_looks_catastrophic(51, 100), "> 50% must trip");
        assert!(!purge_looks_catastrophic(50, 100), "exactly 50% must not trip");
        assert!(!purge_looks_catastrophic(10, 100), "well under half must not trip");
    }

    #[test]
    fn breaker_is_disarmed_below_the_floor() {
        // A tiny workspace deleting all its files is normal — never trip below floor.
        assert!(!purge_looks_catastrophic(
            PURGE_BREAKER_FLOOR - 1,
            PURGE_BREAKER_FLOOR - 1
        ));
        // At the floor with a > 50% ratio it arms.
        assert!(purge_looks_catastrophic(PURGE_BREAKER_FLOOR, PURGE_BREAKER_FLOOR));
    }

    #[test]
    fn breaker_catches_the_observed_bench_flood_shape() {
        // The bench observed ~2,292 of ~2,524 indexed files looking deleted.
        assert!(purge_looks_catastrophic(2292, 2524));
    }

    // ── Defense in depth: the consecutive-failure backoff ──────────────────
    #[test]
    fn backoff_aborts_on_the_nth_consecutive_failure() {
        let mut b = DeleteBackoff::default();
        for _ in 0..(MAX_CONSECUTIVE_DELETE_FAILURES - 1) {
            assert!(!b.on_failure(), "should not abort before the threshold");
        }
        assert!(
            b.on_failure(),
            "the Nth consecutive failure aborts the purge loop"
        );
    }

    #[test]
    fn backoff_resets_the_run_on_any_success() {
        let mut b = DeleteBackoff::default();
        for _ in 0..(MAX_CONSECUTIVE_DELETE_FAILURES - 1) {
            assert!(!b.on_failure());
        }
        b.on_success();
        // A success restarts the run: one more failure must not abort.
        assert!(
            !b.on_failure(),
            "a sprinkling of failures among successes must never trip the backoff"
        );
    }

    // ── Degraded-purge recovery must DROP + rebuild (P1: content-leak fix) ──
    // The Boot-A/Boot-B/Boot-C invariant: a degraded purge (Boot A) sets the
    // durable rebuild-required sentinel; the recovery boot (Boot B) MUST see that
    // as a drop-and-rebuild trigger — NOT a plain full walk, which would leave the
    // un-purged deleted rows live and then clear the fail-closed flag. This locks
    // `rebuild_required` into the destructive-rebuild decision so a future edit
    // can't silently downgrade the recovery to a leaky full walk.
    #[test]
    fn rebuild_required_forces_a_drop_and_rebuild() {
        assert!(
            needs_drop_and_rebuild(false, false, true),
            "a degraded-purge recovery must drop + rebuild, not just full-walk"
        );
    }

    #[test]
    fn migration_and_stale_key_format_still_force_a_drop_and_rebuild() {
        assert!(needs_drop_and_rebuild(true, false, false));
        assert!(needs_drop_and_rebuild(false, true, false));
    }

    #[test]
    fn no_signal_means_no_drop() {
        assert!(
            !needs_drop_and_rebuild(false, false, false),
            "a routine reconcile must not drop the table"
        );
    }

    // ── Latch re-arm on an early setup bail (P2: in-session recovery) ───────
    // A DEFAULT walk consumes the once-per-activation latch up front. If setup
    // then bails (e.g. a transient lock on the forced-rebuild drop_table), the
    // latch must be re-armed so the NEXT reconcile in the SAME activation retries
    // — otherwise a fail-closed / rebuild-pending index can't recover until an
    // app/workspace restart.
    #[test]
    fn early_setup_bail_rearms_the_latch_for_a_same_activation_retry() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let latch = Arc::new(AtomicBool::new(true));
        // The default walk consumes the latch (true → false).
        assert!(latch
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok());
        {
            let _g = RelatchGuard::new(latch.clone());
            // ...then setup bails before disarm — the guard drops still armed.
        }
        assert!(
            latch.load(Ordering::SeqCst),
            "an early bail must re-arm the latch"
        );
        // The next reconcile in this activation therefore RUNS (its compare_exchange
        // succeeds) instead of short-circuiting on a stuck-false latch.
        assert!(
            latch
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok(),
            "the retry reconcile must be able to consume the re-armed latch"
        );
    }

    #[test]
    fn disarmed_guard_leaves_the_latch_to_finalize() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let latch = Arc::new(AtomicBool::new(false)); // consumed by the walk
        {
            let mut g = RelatchGuard::new(latch.clone());
            g.disarm(); // setup succeeded — finalize_walk now owns the latch
        }
        assert!(
            !latch.load(Ordering::SeqCst),
            "a completed setup must not re-arm behind finalize_walk"
        );
    }
}

// ── QA-92: a boot reconcile must never SKIP a manifest-"fresh" file whose
//    vector rows are actually missing (the pre-existing-files-invisible bug) ──
#[cfg(test)]
mod qa92_tests {
    use super::*;
    use std::collections::HashMap;

    const TEST_KEY: [u8; 32] = [0x51u8; 32];

    fn entry(matter: &str, privilege: &str, row_count: u32) -> manifest::SourceSignature {
        manifest::SourceSignature {
            size: 100,
            mtime_ns: 42,
            hash: None,
            extractor_version: 0,
            chunker_version: 0,
            embedder_version: String::new(),
            pdf: None,
            matter_id: matter.to_string(),
            privilege: privilege.to_string(),
            meeting_derived: false,
            row_count,
            indexed_at: 0,
        }
    }

    fn counts(
        pairs: &[(&str, &str, &str, usize)],
    ) -> HashMap<(String, String, String), usize> {
        pairs
            .iter()
            .map(|(tok, m, p, n)| ((tok.to_string(), m.to_string(), p.to_string()), *n))
            .collect()
    }

    // RED before the fix: the pre-fix reconcile skips this file, leaving it
    // unsearchable forever. After the fix, a fresh entry with NO rows must be
    // re-indexed (not row-backed).
    #[test]
    fn fresh_entry_without_any_rows_is_not_row_backed() {
        let e = entry("m-1", store::PRIVILEGE_NONE, 3);
        assert!(!reconcile_skip_is_row_backed(&e, "tok-A", &counts(&[])));
    }

    // RED before the fix: only SOME of the expected rows survived (a partial
    // index / interrupted write). Must re-index.
    #[test]
    fn fresh_entry_with_partial_rows_is_not_row_backed() {
        let e = entry("m-1", store::PRIVILEGE_NONE, 3);
        let c = counts(&[("tok-A", "m-1", store::PRIVILEGE_NONE, 2)]);
        assert!(!reconcile_skip_is_row_backed(&e, "tok-A", &c));
    }

    // RED before the fix: a receipt that recorded 0 rows for a real file can't
    // prove anything (legacy single-file writes stored 0). Re-index.
    #[test]
    fn zero_row_count_entry_is_not_row_backed() {
        let e = entry("m-1", store::PRIVILEGE_NONE, 0);
        let c = counts(&[("tok-A", "m-1", store::PRIVILEGE_NONE, 5)]);
        assert!(!reconcile_skip_is_row_backed(&e, "tok-A", &c));
    }

    // RED before the fix: rows exist for this path but under a DIFFERENT matter
    // (the retag-divergence case — manifest flipped to m-2 while rows stayed
    // under m-1). Skipping would leave the file invisible under m-2. Re-index.
    #[test]
    fn rows_under_a_different_scope_do_not_back_skip() {
        let e = entry("m-2", store::PRIVILEGE_NONE, 2);
        let c = counts(&[("tok-A", "m-1", store::PRIVILEGE_NONE, 2)]);
        assert!(!reconcile_skip_is_row_backed(&e, "tok-A", &c));
    }

    // GREEN both before and after (a genuinely row-backed file must still skip —
    // the fix must not force a needless re-embed of every unchanged file).
    #[test]
    fn fresh_entry_with_enough_rows_under_scope_is_row_backed() {
        let e = entry("m-1", store::PRIVILEGE_NONE, 2);
        let c = counts(&[("tok-A", "m-1", store::PRIVILEGE_NONE, 2)]);
        assert!(reconcile_skip_is_row_backed(&e, "tok-A", &c));
    }

    // Near-end-to-end: prove `scoped_row_counts` reflects the real table and
    // that the skip decision it feeds is correct. pathA is truly indexed (2
    // rows) → skip; pathB has a fresh manifest entry but ZERO rows → re-index.
    #[tokio::test]
    async fn scoped_counts_gate_skip_end_to_end() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();

        let path_a = workspace.join("indexed.docx").to_string_lossy().to_string();
        let tok_a = crypto::path_token(&TEST_KEY, &path_a);
        store::upsert_chunks_for_path(
            &table,
            &path_a,
            vec![
                (
                    chunker::Chunk {
                        path: path_a.clone(),
                        paragraph_index: 0,
                        text: "portfolio review".to_string(),
                        start_offset: 0,
                        end_offset: 16,
                        locator: None,
                    },
                    vec![0.1; embedder::EMBEDDING_DIM],
                ),
                (
                    chunker::Chunk {
                        path: path_a.clone(),
                        paragraph_index: 1,
                        text: "tax planning".to_string(),
                        start_offset: 17,
                        end_offset: 29,
                        locator: None,
                    },
                    vec![0.2; embedder::EMBEDDING_DIM],
                ),
            ],
            store::SourceType::Text,
            "m-1",
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .unwrap();

        // pathB is on disk with a "fresh" manifest entry but was never written
        // to the vector table (the QA-92 symptom).
        let path_b = workspace.join("preexisting.docx").to_string_lossy().to_string();
        let tok_b = crypto::path_token(&TEST_KEY, &path_b);

        let scoped = store::scoped_row_counts(&table).await.unwrap();
        assert_eq!(
            scoped.get(&(tok_a.clone(), "m-1".to_string(), store::PRIVILEGE_NONE.to_string())),
            Some(&2),
            "the truly-indexed file must show its 2 rows under (m-1, none)"
        );

        let entry_a = entry("m-1", store::PRIVILEGE_NONE, 2);
        let entry_b = entry("m-1", store::PRIVILEGE_NONE, 2);
        assert!(
            reconcile_skip_is_row_backed(&entry_a, &tok_a, &scoped),
            "a file whose rows are present must skip"
        );
        assert!(
            !reconcile_skip_is_row_backed(&entry_b, &tok_b, &scoped),
            "a pre-existing file with a fresh receipt but NO rows must re-index"
        );
    }

    // QA-92 round 2: a MIXED batch retag must be checked PER PATH — the file
    // with rows under the target matter is fine, but the sibling with zero rows
    // (never indexed / path-form mismatch) is a miss and must be reported so the
    // caller re-indexes only it. The aggregate rows-updated count hides this.
    #[tokio::test]
    async fn paths_missing_rows_under_matter_flags_only_the_zero_row_path() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();

        // plan.docx has rows under matter m-acme; statement.pdf has none.
        let has_rows = workspace.join("Acme/plan.docx").to_string_lossy().to_string();
        let no_rows = workspace.join("Acme/statement.pdf").to_string_lossy().to_string();
        store::upsert_chunks_for_path(
            &table,
            &has_rows,
            vec![(
                chunker::Chunk {
                    path: has_rows.clone(),
                    paragraph_index: 0,
                    text: "retirement plan".to_string(),
                    start_offset: 0,
                    end_offset: 15,
                    locator: None,
                },
                vec![0.1; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            "m-acme",
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .unwrap();

        let misses = store::paths_missing_rows_under_matter(
            &table,
            &[has_rows.clone(), no_rows.clone()],
            "m-acme",
            &TEST_KEY,
        )
        .await
        .unwrap();

        assert_eq!(
            misses,
            vec![no_rows],
            "only the zero-row sibling must be reported as a miss"
        );
    }

    // A path whose rows live under a DIFFERENT matter is a miss for the target
    // matter (it needs (re)indexing/retag under the target), and it must NOT be
    // wrongly treated as present just because it has rows somewhere.
    #[tokio::test]
    async fn paths_under_a_different_matter_are_misses_for_the_target() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();

        let path = workspace.join("doc.docx").to_string_lossy().to_string();
        store::upsert_chunks_for_path(
            &table,
            &path,
            vec![(
                chunker::Chunk {
                    path: path.clone(),
                    paragraph_index: 0,
                    text: "held elsewhere".to_string(),
                    start_offset: 0,
                    end_offset: 14,
                    locator: None,
                },
                vec![0.3; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            "m-other",
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .unwrap();

        let misses =
            store::paths_missing_rows_under_matter(&table, &[path.clone()], "m-acme", &TEST_KEY)
                .await
                .unwrap();
        assert_eq!(misses, vec![path], "rows under another matter don't count");
    }
}
