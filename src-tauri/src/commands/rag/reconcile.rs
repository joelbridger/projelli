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
    if needs_drop_and_rebuild(migrating, stale_key_format, rebuild_required) {
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
        manifest::delete(&workspace);
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
    let mut manifest = if effective_full {
        manifest::Manifest::new(store::INDEX_VERSION)
    } else {
        manifest::load(&workspace, store::INDEX_VERSION)
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
    }
    let mut work: Vec<WorkItem> = Vec::new();
    let mut reused: u32 = 0;
    // The text/office manifest entries this walk will persist: reused files carry
    // their existing fresh signature forward; (re)indexed files get a fresh one.
    let mut next_sources: std::collections::BTreeMap<String, manifest::SourceSignature> =
        std::collections::BTreeMap::new();

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
            manifest::FileDecision::Skip => {
                if let Some(entry) = manifest.get(&token) {
                    next_sources.insert(token, entry.clone());
                }
                reused += 1;
            }
            manifest::FileDecision::Reindex { prior_scope } => {
                let (m, p) = prior_scope.unwrap_or_else(|| {
                    (
                        store::UNASSIGNED_MATTER.to_string(),
                        store::PRIVILEGE_NONE.to_string(),
                    )
                });
                work.push(WorkItem { file: file.clone(), matter: m, privilege: p });
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
                    text_source_signature(&item.file, &item.matter, &item.privilege, rc)
                {
                    next_sources.insert(token, sig);
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
            }),
            ..text_sig()
        }
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
}
