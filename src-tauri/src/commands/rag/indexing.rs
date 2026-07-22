use super::*;

/// Set or replace the active workspace root the RAG indexer points at.
/// Called when the user opens a workspace, before any indexing.
#[tauri::command]
pub async fn rag_set_workspace(
    state: State<'_, RagState>,
    path: String,
) -> Result<u64, String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("workspace path does not exist: {}", path));
    }
    let _switch_guard = state.workspace_switch_lock.lock().await;
    let mut guard = state.workspace_root.lock().await;
    // F-301: only arm the once-per-activation full-index latch when the workspace
    // root actually CHANGES. `useMemoryWiring` calls this on every mount, and the
    // RagState lives in the Rust process — so it survives webview reloads. A dev
    // HMR reload-storm re-mounts the frontend many times for the SAME workspace;
    // re-arming on each of those would re-trigger the destructive full re-index
    // (drop_table + rebuild) over and over and run memory away. Re-opening the
    // SAME already-active workspace is a no-op for indexing (the watcher keeps the
    // index live incrementally); a real switch to a DIFFERENT workspace re-arms.
    //
    // Windows path-correctness: the frontend may hand us the same physical folder
    // spelled differently across mounts — `C:\WS` vs `C:/WS` vs `c:\ws` (mixed
    // separators / drive-letter case). A raw `PathBuf` compare treats those as
    // DIFFERENT roots and triggers a spurious destructive full re-index. Compare
    // the OS-canonical form of both paths so only a genuine workspace switch
    // re-arms. `canonicalize` collapses separators + case (and resolves symlinks)
    // on the real filesystem; we fall back to the raw path if it ever fails so a
    // canonicalize error can't wedge activation.
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let changed = guard.as_deref().map(canon) != Some(canon(&target));
    // BUG-099 durable tombstone: re-hydrate the in-memory unsafe-TOKEN set from
    // disk so the fail-closed exclusion survives an app restart (a fresh process
    // starts with an empty set while stale rows are still durable on disk).
    //
    // CRITICAL — never DROP a live tombstone on a same-workspace remount. This
    // command fires on EVERY frontend mount (the dev HMR reload-storm; a webview
    // reload), not just real workspace switches. If a cleanup failed AND its
    // durable persist ALSO failed, the token lives ONLY in memory; the disk file
    // is empty/stale. Unconditionally overwriting the in-memory set with the disk
    // contents on a remount would silently re-expose those stale rows. So:
    //   - real SWITCH / first activation → REPLACE with the disk set (the new
    //     workspace's own durable tombstones; the old workspace's are irrelevant).
    //   - same-workspace re-set → MERGE (union) the disk set INTO the live set, so
    //     a live in-memory-only tombstone can never be lost to a remount.
    //
    // FAIL CLOSED: if the durable file EXISTS but is UNREADABLE (corruption /
    // lock / permission), the real tombstone set is unknown — set the
    // integrity-unknown flag so retrieval/verify refuse to serve until a clean
    // re-index rewrites the file. We do NOT clear live in-memory tokens in that
    // case (keep whatever protection we have), and a real switch leaves the
    // previous workspace's tokens behind (they don't match the new workspace).
    {
        match store::read_unsafe_tokens(&target) {
            store::TombstoneRead::Tokens(durable) => {
                let mut live = state.unsafe_tokens.lock().await;
                if changed {
                    *live = durable;
                } else {
                    live.extend(durable);
                }
                state.index_integrity_unknown.store(false, Ordering::SeqCst);
            }
            store::TombstoneRead::IntegrityUnknown => {
                // Cannot trust the on-disk set. Fail closed until a clean re-index.
                if changed {
                    // New workspace: start the live set empty (the old ws tokens
                    // are irrelevant) but mark integrity unknown so nothing is served.
                    state.unsafe_tokens.lock().await.clear();
                }
                state.index_integrity_unknown.store(true, Ordering::SeqCst);
                log::error!(
                    "rag_set_workspace: durable tombstone unreadable for {} — \
                     retrieval will fail closed until a clean re-index",
                    target.display()
                );
            }
        }
    }
    // A stale-key-format manifest (older than the current MANIFEST_VERSION) must
    // force a drop+rebuild. Record that durably NOW, at the earliest per-open
    // hook, so a pre-reconcile incremental manifest write (PDF-record / watcher
    // index) can't load+save it forward to the current version and erase the
    // signal before reconcile checks it. (Every manifest writer calls
    // `require_workspace`, which needs the root set below — so this always wins.)
    mark_rebuild_if_manifest_stale(&target);

    *guard = Some(target);
    let activation = if changed {
        state.workspace_activation.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        state.workspace_activation.load(Ordering::SeqCst)
    };
    state.cancel_flag.store(false, Ordering::SeqCst);
    if changed {
        state.full_index_pending.store(true, Ordering::SeqCst);
        // P2.1 (Finding 4): a real workspace switch invalidates the cached table
        // handle (it pointed at the old workspace's dataset). `cached_chunks_table`
        // also re-opens on a path mismatch, but clearing here frees the old handle
        // promptly and keeps the cache honest.
        invalidate_table_cache(&state).await;
    }
    Ok(activation)
}

/// Index a single file into the local RAG store. Idempotent — re-running
/// for the same path drops stale chunks first.
///
/// WS-B/C: `matter_id` is the confidentiality scope the file is filed under.
/// `None` means "not yet categorized" and is stored under the explicit
/// `UNASSIGNED_MATTER` sentinel — NEVER null/empty (a null matter is a
/// confidentiality hazard). The matter-assignment UI (a separate task) passes a
/// real id here; the file watcher passes `None` until then.
///
/// Vault note: indexing may run over files read while the vault is unlocked, but
/// the resulting vector embeddings are not currently locked/wiped with the vault.
/// Keep marketing wording honest until the vector-store lifecycle is wired to
/// vault lock/unlock (or semantic indexing is disabled for vaulted workspaces).
#[tauri::command]
pub async fn rag_index_file(
    state: State<'_, RagState>,
    path: String,
    matter_id: Option<String>,
    privilege: Option<String>,
    source_type: Option<String>,
) -> Result<(), String> {
    let matter = resolve_matter(matter_id.as_deref())?;
    let privilege = resolve_privilege(privilege.as_deref())?;
    let meeting_derived = match source_type.as_deref() {
        None | Some("") => false,
        Some("meeting") => true,
        Some(other) => return Err(format!("invalid file source_type: {other}")),
    };
    let workspace = require_workspace(&state).await?;
    let file_path = PathBuf::from(&path);
    // fix/ask-list-hang — NEVER index our own internal plumbing. The full walk
    // skips `.lantern/` up front, but this single-file (watcher-triggered) path
    // did not, so the MCP session-scope heartbeat's constant
    // `.lantern/mcp-session-scope.json` rewrites were re-indexed on every change,
    // keeping LanceDB perpetually busy and starving Ask retrieval into a hang.
    // Scope the skipped-dir check to the workspace-RELATIVE path (like the full
    // walker) so a workspace that merely LIVES under a folder named
    // build/target/node_modules/… doesn't make every file falsely "internal".
    if extractor::is_in_skipped_dir_under(&workspace, &file_path) {
        return Ok(());
    }
    if !extractor::is_indexable(&file_path) {
        // Silently succeed — the watcher fires for everything and we don't
        // want unsupported files to noisy-error.
        return Ok(());
    }

    // WS-VEC: the vector-store master key — chunk text is encrypted at rest.
    let key = crypto::get_or_create_master_key().map_err(|e| format!("vectors key: {e}"))?;

    // QA-88: the meeting pipeline now explicitly indexes transcript.json and
    // notes.docx immediately after writing them, and the file watcher may still
    // fire for the same path moments later. If the manifest says this exact file
    // version is already indexed under the same matter/privilege scope, the
    // second call is a cheap no-op instead of re-extracting/re-embedding.
    let token = crypto::path_token(&key, &file_path.to_string_lossy());
    let tombstoned = state.unsafe_tokens.lock().await.contains(&token);
    let (manifest_fresh_for_scope, manifest_meeting_derived) = {
        let _mg = state.manifest_lock.lock().await;
        let manifest = manifest::load(&workspace, store::INDEX_VERSION);
        let entry = manifest.get(&token);
        (
            entry.and_then(|entry| {
                text_manifest_entry_is_fresh_for_scope(
                    Some(entry),
                    &file_path,
                    &matter,
                    &privilege,
                    tombstoned,
                )
                .then_some(entry.row_count)
            }),
            entry.is_some_and(|entry| entry.meeting_derived),
        )
    };

    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    let recorded_meeting_derived = if manifest_meeting_derived {
        true
    } else {
        store::path_has_meeting_source_type(
            &table,
            &file_path.to_string_lossy(),
            &key,
        )
        .await
        .map_err(|e| format!("check durable meeting provenance: {e:#}"))?
    };

    if recorded_meeting_derived && !meeting_derived {
        store::delete_path(&table, &file_path.to_string_lossy(), &key)
            .await
            .map_err(|e| format!("purge meeting source missing visibility manifest: {e:#}"))?;
        return Err(
            "meeting-derived source is missing its visibility manifest; indexing refused"
                .to_string(),
        );
    }

    if text_manifest_fast_path_can_skip(
        &table,
        manifest_fresh_for_scope,
        &file_path,
        &matter,
        &privilege,
        &key,
    )
    .await
    .map_err(|e| format!("check indexed rows: {e}"))?
    {
        if meeting_derived {
            store::retag_meeting_source_type_for_path(
                &table,
                &file_path.to_string_lossy(),
                &key,
            )
            .await
            .map_err(|e| format!("stamp meeting provenance: {e:#}"))?;
            record_text_manifest_entry(
                &state,
                &workspace,
                &file_path,
                &matter,
                &privilege,
                manifest_fresh_for_scope.unwrap_or(0),
                true,
                &key,
            )
            .await;
        }
        return Ok(());
    }

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
    match index_one_file(&table, &file_path, &matter, &privilege, &key, None, vault_vmk).await {
        Ok(indexed) => {
            if indexed && meeting_derived {
                store::retag_meeting_source_type_for_path(
                    &table,
                    &file_path.to_string_lossy(),
                    &key,
                )
                .await
                .map_err(|e| format!("stamp meeting provenance: {e:#}"))?;
            }
            // vault_vmk_holder is dropped (and ZeroizedVmk zeroizes) at fn exit.
            // BUG-099 tombstone self-heal: the file watcher's per-file re-index
            // CLEARS this path's tombstone (in memory AND on disk). Without this,
            // a file the user fixed (whose cleanup had failed during a walk) would
            // re-index its fresh rows but stay filtered out of retrieval until a
            // full walk or restart. `index_one_file` is delete-then-add (an
            // upsert), so a successful return means the path's rows are consistent.
            clear_tombstone(&state, &workspace, &path, &key).await;
            // P1.1: refresh the manifest signature under the scope actually used so
            // a later boot reconcile skips this file while unchanged and re-indexes
            // it under the CORRECT matter/privilege when it changes — but ONLY when
            // the file was actually indexed. A DELETE-ONLY outcome (a transiently
            // unreadable / too-large / unparseable file, `indexed == false`) records
            // NO signature, so it is retried next boot instead of cached as fresh.
            if indexed {
                let row_count = store::path_row_count_for_scope(
                    &table,
                    &file_path.to_string_lossy(),
                    &matter,
                    &privilege,
                    &key,
                )
                .await
                .unwrap_or_else(|e| {
                    log::warn!(
                        "rag: failed to count rows after single-file index for {}: {e:#}",
                        file_path.display()
                    );
                    0
                });
                record_text_manifest_entry(
                    &state,
                    &workspace,
                    &file_path,
                    &matter,
                    &privilege,
                    row_count as u32,
                    meeting_derived,
                    &key,
                )
                .await;
            }
            Ok(())
        }
        Err(e) => {
            // BUG-099 fail-closed (watcher parity with the full walk): a failed
            // incremental index may have left stale rows (e.g. its internal
            // delete-then-add failed mid-way, or the stale-row cleanup delete
            // for a now-unreadable/oversized file failed). Durably tombstone the
            // path so GUI retrieval cannot serve those stale rows until a later
            // successful re-index clears it — including after an app restart. A
            // stale citation must be impossible after a cleanup failure on EITHER
            // indexing path. (The in-memory exclusion applies even if the durable
            // write also fails; we log that and still return the index error.)
            if let Err(persist_err) = tombstone_path(&state, &workspace, &path, &key).await {
                log::error!(
                    "rag_index_file: DURABLE tombstone persist FAILED for {} — \
                     in-memory exclusion holds this session but NOT across restart: {persist_err:#}",
                    file_path.display()
                );
            }
            log::error!(
                "rag_index_file: path tombstoned for {} — incremental re-index \
                 failed; its stale rows are excluded from retrieval until a \
                 successful re-index clears the tombstone: {e:#}",
                file_path.display()
            );
            Err(format!("index_file failed: {e:#}"))
        }
    }
}

/// Resolve an optional caller-supplied matter id into a concrete, validated
/// scope key. `None`/`Some("")` → the `UNASSIGNED_MATTER` sentinel. A non-empty
/// id is validated (defence-in-depth before it ever reaches a SQL filter).
pub(crate) fn resolve_matter(matter_id: Option<&str>) -> Result<String, String> {
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
pub(crate) fn resolve_privilege(privilege: Option<&str>) -> Result<String, String> {
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
pub(crate) fn decrypt_if_vaulted(bytes: Vec<u8>, vault_vmk: Option<&[u8; 32]>) -> Vec<u8> {
    let Some(vmk) = vault_vmk else { return bytes; };
    if !lantern_vault::format::has_vault_magic(&bytes) {
        return bytes;
    }
    match lantern_vault::format::decrypt_file(&bytes, vmk) {
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
pub(crate) enum ExtractedFileData {
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

impl ExtractedFileData {
    /// Number of chunk rows this extraction will write (0 for delete/skip
    /// variants). Recorded in the manifest as informational `row_count`.
    fn row_count(&self) -> u32 {
        match self {
            ExtractedFileData::ShouldDelete | ExtractedFileData::SkippedUnreadable => 0,
            ExtractedFileData::Flat { rows, .. } => rows.len() as u32,
            ExtractedFileData::Grouped { groups } => {
                groups.iter().map(|(_, rows)| rows.len() as u32).sum()
            }
        }
    }
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
pub(crate) async fn extract_embed_one_file(
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
                // Missing or too large — silent skip (expected, not a failure).
                return Ok(Some(ExtractedFileData::ShouldDelete));
            };
            let decrypted = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let Some(text) = String::from_utf8(decrypted).ok() else {
                // A readable text file whose bytes are not valid UTF-8 is genuinely
                // unreadable (corrupt / wrong encoding), NOT a clean skip — surface
                // it as a reported failure so the banner does not count it as
                // indexed (mirrors the office-file SkippedUnreadable path).
                log::warn!(
                    "rag: skipping non-UTF-8 text file {} (counted as failed)",
                    file_path.display()
                );
                return Ok(Some(ExtractedFileData::SkippedUnreadable));
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
                extractor::IndexKind::Docx => lantern_docx::parse_docx_bytes(&bytes)
                    .map(|doc| lantern_docx::extract_paragraph_texts(&doc).join("\n\n"))
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
pub(crate) async fn write_extracted_file(
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
) -> anyhow::Result<bool> {
    // P1.1: returns Ok(true) when the file was actually indexed (rows written or a
    // readable-but-empty file), Ok(false) for a DELETE-ONLY outcome — a missing /
    // too-large / unreadable / parse-failed file whose stale rows were dropped. The
    // caller (`rag_index_file`) records a manifest freshness signature ONLY on
    // Ok(true), so a transiently-unreadable file (locked / OneDrive-offline) is
    // retried next boot instead of being cached as fresh-and-empty (and thus
    // silently dropped from search until its size/mtime changes).
    let path_str = file_path.to_string_lossy().to_string();
    let Some(kind) = extractor::classify(file_path) else {
        // Callers gate on `is_indexable` (== classify().is_some()), so this
        // arm is defensive only.
        return Ok(false);
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
                return Ok(false);
            };
            let decrypted = decrypt_if_vaulted(raw_bytes, vault_vmk);
            let Some(text) = String::from_utf8(decrypted).ok() else {
                // After decryption the bytes are not valid UTF-8 — skip this file.
                store::delete_path(table, &path_str, key).await?;
                return Ok(false);
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
                .await
                .map(|()| true);
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
            .map(|()| true)
        }
        extractor::IndexKind::Docx | extractor::IndexKind::Rtf => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str, key).await?;
                return Ok(false);
            };
            // VG-6d: decrypt in memory before passing to the office extractor.
            let bytes = decrypt_if_vaulted(raw_bytes, vault_vmk);
            // The document's CURRENT READING as plain text: tracked
            // insertions in, deletions out, no raw markup (text.rs); rtf
            // decodes control words/escapes to text (office.rs).
            let extracted: anyhow::Result<String> = match kind {
                extractor::IndexKind::Docx => lantern_docx::parse_docx_bytes(&bytes)
                    .map(|doc| lantern_docx::extract_paragraph_texts(&doc).join("\n\n"))
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
                    return Ok(false);
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
            .map(|()| true)
        }
        extractor::IndexKind::Xlsx | extractor::IndexKind::Pptx => {
            let Some(raw_bytes) = extractor::read_bytes(file_path) else {
                store::delete_path(table, &path_str, key).await?;
                return Ok(false);
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
                    return Ok(false);
                }
            };
            // A valid package with no extractable sheets/slides is EMPTY
            // TEXT, not an error: drop stale rows, store nothing.
            let banded = build_section_chunks(&path_str, &sections);
            if banded.iter().all(|(_, chunks)| chunks.is_empty()) {
                store::delete_path(table, &path_str, key).await?;
                return Ok(false);
            }
            let texts: Vec<String> = banded
                .iter()
                .flat_map(|(_, chunks)| chunks.iter().map(|c| c.text.clone()))
                .collect();
            // F-501 — same bounded, cancel-aware embedding as every other
            // index path; never a new unbatched embed call.
            let Some(vectors) = embedder::embed_documents_batched(&texts, cancel).await? else {
                return Ok(false); // cancelled mid-embed — nothing written
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
            Ok(true)
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
pub(crate) fn build_section_chunks(
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

/// P1.1 — which mode `run_workspace_index` runs in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum IndexMode {
    /// Cold/full walk: (re)index EVERY supported file. Used by the legacy
    /// `rag_index_workspace` command (scoped re-index + explicit full rebuilds)
    /// and forced whenever a schema migration or a fail-closed integrity-unknown
    /// state requires rebuilding the whole store from scratch.
    Full,
    /// Boot reconcile: stat-walk the tree, then (re)index only new/changed files,
    /// purge rows for files deleted since the last index, and SKIP everything whose
    /// signature is unchanged. The whole P1.1 win.
    Reconcile,
}

/// P1.1 — mutable per-walk tally shared by `process_one_workspace_file`. Groups
/// the BUG-099 skip/fail/tombstone bookkeeping so the same per-file logic serves
/// both the full walk and the reconcile walk (one source of truth for the
/// fail-closed guarantees).
#[derive(Default)]
pub(crate) struct IndexTally {
    pub(crate) skipped_files: u32,
    pub(crate) failed_files: u32,
    pub(crate) timed_out_files: u32,
    pub(crate) cleanup_failed_files: u32,
    /// BUG-099: set if ANY durable tombstone write failed this walk. When true the
    /// walk must NOT stamp completion, so the next launch re-runs a full walk.
    pub(crate) durable_tombstone_failed: bool,
    /// Set when the deleted-source purge was aborted by the mass-deletion sanity
    /// breaker or the consecutive-failure backoff. Like `durable_tombstone_failed`
    /// it stops the walk stamping completion, so the escalated rebuild (already
    /// armed via the durable integrity-unknown sentinel) actually runs next launch.
    pub(crate) purge_degraded: bool,
    pub(crate) skipped_paths: Vec<String>,
}

/// P1.1 — result of processing one file, telling the caller how to update the
/// manifest and progress counters.
pub(crate) enum FileProcess {
    /// `(Indexed, None)` from the extract task: the user cancelled mid-file.
    /// Nothing was written; the caller's next cancel check ends the walk. Not
    /// counted as re-indexed and no manifest signature is recorded.
    CancelledMidFile,
    /// Cleanly indexed (or a clean silent skip: empty / too-large / missing) —
    /// the caller records a FRESH manifest signature carrying this row count.
    Recorded(u32),
    /// The durable index receipt says this was meeting-derived, but its exact
    /// sibling visibility manifest is now missing or no longer names the file.
    /// Rows were purged; the caller must retain the provenance receipt so a
    /// later walk cannot reclassify it as an ordinary document.
    ProtectedMeetingMissingManifest,
    /// Failed / unreadable / purge-failed — the caller records NO manifest
    /// signature so the file is retried on the next boot.
    NotRecorded,
}

pub(crate) fn exact_meeting_manifest_names_file(file: &Path) -> bool {
    file.parent()
        .and_then(|parent| std::fs::read(parent.join("meeting.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("meetingFileVisibility").cloned())
        .and_then(|manifest| manifest.get("files").cloned())
        .and_then(|files| files.as_object().cloned())
        .is_some_and(|files| {
            file.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| files.contains_key(name))
        })
}

/// P1.1 — process exactly one workspace file: extract+embed under the timeout,
/// write (single-writer), purge/tombstone on skip, and emit per-file progress.
/// This is the SHARED per-file body used by both the full walk and the reconcile
/// walk, so the BUG-099 fail-closed bookkeeping lives in exactly one place.
///
/// `matter`/`privilege` are the scope this file's rows are written under. The
/// full walk passes the workspace-default scope; the reconcile walk passes each
/// EXISTING file's previously-recorded scope (so a changed file is never widened
/// to `unassigned`) and the default only for genuinely new files.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn process_one_workspace_file(
    app: &AppHandle,
    state: &RagState,
    table: &lancedb::Table,
    workspace: &Path,
    file: &Path,
    matter: &str,
    privilege: &str,
    known_meeting_derived: bool,
    key: &[u8; 32],
    vault_vmk: Option<[u8; 32]>,
    cancel: &Arc<AtomicBool>,
    processed: u32,
    total: u32,
    tally: &mut IndexTally,
) -> FileProcess {
    let current_meeting_derived = exact_meeting_manifest_names_file(file);
    if known_meeting_derived && !current_meeting_derived {
        let path_str = file.to_string_lossy().to_string();
        match store::delete_path(table, &path_str, key).await {
            Ok(()) => {
                clear_tombstone(state, workspace, &path_str, key).await;
                return FileProcess::ProtectedMeetingMissingManifest;
            }
            Err(error) => {
                if tombstone_path(state, workspace, &path_str, key).await.is_err() {
                    tally.durable_tombstone_failed = true;
                }
                tally.cleanup_failed_files += 1;
                tally.skipped_files += 1;
                tally.failed_files += 1;
                tally.skipped_paths.push(path_str);
                log::error!(
                    "rag: could not purge meeting-derived source with missing manifest: {error:#}"
                );
                return FileProcess::ProtectedMeetingMissingManifest;
            }
        }
    }
    let file_for_task = file.to_path_buf();
    let cancel_for_task = cancel.clone();
    let vault_vmk_for_task = vault_vmk;
    let (outcome, extracted) = run_file_extract_task(
        file.to_path_buf(),
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

    let mut recorded_rows: Option<u32> = None;

    // Parent is sole DB writer: on success write the extracted data; on skip
    // the write is skipped (stale rows are purged below).
    if matches!(outcome, FileIndexOutcome::Indexed) {
        if let Some(data) = extracted {
            let path_str = file.to_string_lossy().to_string();
            let row_count = data.row_count();
            // A `ShouldDelete` outcome is delete-only: it covers an intentional
            // skip (empty / oversized) AND a TRANSIENT read failure (a locked or
            // OneDrive-offline file that can still be stat'd — `read_*_bytes`
            // returns None for both). We must NOT record a fresh signature for it,
            // or a warm boot would skip the file forever until its size/mtime
            // changes, silently dropping a temporarily-unreadable file from search.
            // Re-attempting the (cheap) read next boot is the fail-safe choice.
            let delete_only = matches!(data, ExtractedFileData::ShouldDelete);
            let write_result =
                write_extracted_file(table, &path_str, data, matter, privilege, key).await;
            let write_result = match write_result {
                Ok(skipped) if !skipped && !delete_only && current_meeting_derived => {
                    store::retag_meeting_source_type_for_path(table, &path_str, key)
                        .await
                        .map(|_| skipped)
                }
                other => other,
            };
            match write_result {
                Ok(true) => {
                    // SkippedUnreadable: extraction failed on a readable file. Stale
                    // rows WERE deleted, so the path is safe — clear any tombstone,
                    // but do NOT record a manifest signature (retry next boot).
                    clear_tombstone(state, workspace, &path_str, key).await;
                    tally.skipped_files += 1;
                    tally.failed_files += 1;
                    tally.skipped_paths.push(path_str.clone());
                    log::warn!(
                        "rag: counted as failed skip (unreadable): {}",
                        file.display()
                    );
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        IndexingProgress {
                            status: IndexingStatus::Indexing,
                            processed: processed + 1,
                            total,
                            current_path: Some(path_str),
                            skipped: tally.skipped_files,
                            failed: tally.failed_files,
                            timed_out: tally.timed_out_files,
                            ..Default::default()
                        },
                    );
                    return FileProcess::NotRecorded;
                }
                Ok(false) => {
                    // Normal success (indexed, or a legitimately empty file). Clear
                    // any prior tombstone (self-heal) and record a fresh signature —
                    // EXCEPT for a delete-only outcome (see `delete_only` above),
                    // which we leave unrecorded so a transiently-unreadable file is
                    // retried next boot rather than cached as fresh-and-empty.
                    clear_tombstone(state, workspace, &path_str, key).await;
                    recorded_rows = if delete_only { None } else { Some(row_count) };
                }
                Err(e) => {
                    log::warn!("rag: DB write failed for {}: {e:#}", file.display());
                    // A failed write may leave stale rows — durably tombstone the
                    // path so retrieval cannot serve them until a later clean index.
                    if tombstone_path(state, workspace, &path_str, key).await.is_err() {
                        tally.durable_tombstone_failed = true;
                    }
                    tally.cleanup_failed_files += 1;
                    tally.skipped_files += 1;
                    tally.failed_files += 1;
                    tally.skipped_paths.push(path_str.clone());
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        IndexingProgress {
                            status: IndexingStatus::Indexing,
                            processed: processed + 1,
                            total,
                            current_path: Some(path_str),
                            skipped: tally.skipped_files,
                            failed: tally.failed_files,
                            timed_out: tally.timed_out_files,
                            cleanup_failed: tally.cleanup_failed_files,
                            ..Default::default()
                        },
                    );
                    return FileProcess::NotRecorded;
                }
            }
        } else {
            // `(Indexed, None)`: user cancelled mid-file. Do nothing; the caller's
            // next cancel check ends the walk.
            return FileProcess::CancelledMidFile;
        }
    }

    // BUG-099: drop stale rows for any skipped file BEFORE moving on, so retrieval
    // can never cite an old version of a file we couldn't re-read.
    let purge = purge_stale_rows_on_skip(table, file, key, &outcome).await;
    match outcome {
        FileIndexOutcome::Indexed => {}
        FileIndexOutcome::Failed(_) => {
            tally.skipped_files += 1;
            tally.failed_files += 1;
        }
        FileIndexOutcome::TimedOut => {
            tally.skipped_files += 1;
            tally.timed_out_files += 1;
        }
    }
    match purge {
        PurgeOutcome::NotNeeded => {}
        PurgeOutcome::PurgedCleanly => {
            let path_str = file.to_string_lossy().to_string();
            clear_tombstone(state, workspace, &path_str, key).await;
            tally.skipped_paths.push(path_str);
        }
        PurgeOutcome::PurgeFailed => {
            tally.cleanup_failed_files += 1;
            let path_str = file.to_string_lossy().to_string();
            tally.skipped_paths.push(path_str.clone());
            if tombstone_path(state, workspace, &path_str, key).await.is_err() {
                tally.durable_tombstone_failed = true;
            }
            log::error!(
                "rag: path tombstoned for {} — skipped file AND cleanup failed; \
                 its stale rows are excluded from retrieval until a clean re-index",
                file.display()
            );
        }
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        IndexingProgress {
            status: IndexingStatus::Indexing,
            processed: processed + 1,
            total,
            current_path: Some(file.to_string_lossy().to_string()),
            skipped: tally.skipped_files,
            failed: tally.failed_files,
            timed_out: tally.timed_out_files,
            cleanup_failed: tally.cleanup_failed_files,
            ..Default::default()
        },
    );

    match recorded_rows {
        Some(rc) => FileProcess::Recorded(rc),
        None => {
            // Skipped/failed above with no clean write and no early return — this is
            // a genuinely failed file (Failed/TimedOut). Do not record.
            FileProcess::NotRecorded
        }
    }
}

/// P1.1 — finalize a walk: apply the BUG-099 completion / fail-closed rules and
/// emit the terminal progress event. Shared by the full walk and the reconcile
/// walk so the "when is it safe to stamp completion" decision lives in one place.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn finalize_walk(
    app: &AppHandle,
    state: &RagState,
    workspace: &Path,
    effective_full: bool,
    total: u32,
    tally: &IndexTally,
    reused: u32,
    reindexed: u32,
    deleted: u32,
) {
    let mut fail_closed_unresolved = tally.durable_tombstone_failed || tally.purge_degraded;
    if tally.durable_tombstone_failed || tally.purge_degraded {
        log::error!(
            "rag: this walk did not complete cleanly ({}) — NOT stamping the \
             completion marker so the next launch re-runs a full walk (prevents a \
             stale citation resurfacing on restart)",
            if tally.durable_tombstone_failed {
                "a durable tombstone write failed"
            } else {
                "the deleted-source purge was aborted by the sanity breaker/backoff"
            }
        );
    } else if effective_full {
        // A clean FULL walk re-derived the complete tombstone set (every file was
        // re-indexed). Rewrite the durable file from the current in-memory set so
        // it is known-good, clear the integrity-unknown sentinel, then stamp the
        // schema version. Hold the unsafe-tokens lock across the write so a
        // concurrent watcher tombstone cannot be lost. (See BUG-099.)
        let guard = state.unsafe_tokens.lock().await;
        match store::write_unsafe_tokens(workspace, &guard) {
            Ok(()) => {
                store::clear_integrity_unknown(workspace);
                // A clean full walk (which, on a degraded-purge recovery, was a
                // drop_table + full re-index) has removed every orphaned row, so
                // the rebuild-required demand is satisfied. Clear it here — only on
                // this clean-completion path — so an interrupted rebuild retries.
                store::clear_rebuild_required(workspace);
                state.index_integrity_unknown.store(false, Ordering::SeqCst);
                drop(guard);
                if let Err(e) = store::write_index_version(workspace) {
                    log::warn!("rag: failed to write index version marker: {}", e);
                }
            }
            Err(e) => {
                drop(guard);
                fail_closed_unresolved = true;
                log::error!(
                    "rag: could not rewrite the durable tombstone file after a clean \
                     full walk ({e:#}); leaving integrity flag set and NOT stamping \
                     completion so the next launch re-runs"
                );
            }
        }
    } else {
        // A clean RECONCILE walk does NOT re-derive the whole tombstone set (it only
        // touched changed files), so it must NOT rewrite the durable tombstone file
        // or clear the integrity sentinel — per-file tombstones already persisted
        // incrementally, and a reconcile is only allowed to run when integrity is
        // already known-good (an integrity-unknown state forces a full walk). The
        // schema version is already current (no migration), so stamping is a
        // harmless refresh that records "the store is up to date".
        if let Err(e) = store::write_index_version(workspace) {
            log::warn!("rag: failed to write index version marker: {}", e);
        }
    }

    if fail_closed_unresolved {
        // RECOVERY: re-arm the once-per-activation latch so a retry can re-run, and
        // emit Error (not a happy Done) so the banner prompts a re-index.
        state.full_index_pending.store(true, Ordering::SeqCst);
        let _ = app.emit(
            PROGRESS_EVENT,
            IndexingProgress {
                status: IndexingStatus::Error,
                processed: total,
                total,
                current_path: None,
                skipped: tally.skipped_files,
                failed: tally.failed_files,
                timed_out: tally.timed_out_files,
                cleanup_failed: tally.cleanup_failed_files,
                skipped_paths: cap_skipped_paths(&tally.skipped_paths),
                ..Default::default()
            },
        );
        log::error!(
            "rag: finished in a FAIL-CLOSED state (durable tombstone not persisted) \
             — emitted Error, re-armed the full-index latch for retry"
        );
        return;
    }

    // P2.1 (Finding 1): NO ANN vector index is built. We benchmarked IVF_FLAT
    // vs the brute-force flat scan on a 60k-chunk corpus (see
    // `tests/rag_ann_index_bench.rs`) and the flat scan WON at realistic advisor
    // scale: ~73–92 ms/query and EXACT, while the ANN index was SLOWER (~128–146
    // ms/query, the IVF probe + prefilter overhead doesn't pay off until the
    // corpus is far larger) AND lossy on recall. For a citation product where a
    // missed source is a correctness failure, an exact flat scan that is already
    // fast is the right call. `store::create_vector_index` is kept as benched
    // tooling for a future revisit at 500k+ chunks (where flat becomes seconds),
    // gated behind real-embedding recall validation — but it is NOT auto-enabled.

    let _ = app.emit(
        PROGRESS_EVENT,
        IndexingProgress {
            status: IndexingStatus::Done,
            processed: total,
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
}

/// P1.1 — Unix-seconds "now" for manifest `indexed_at` (best-effort; 0 on a
/// clock before the epoch).
pub(crate) fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// P1.1 — build the fresh manifest signature for a just-indexed text/office file.
/// (PDF signatures are recorded separately from the frontend PDF-index path via
/// `rag_manifest_record_pdf`, since PDFs are not in the Rust walker.)
pub(crate) fn text_source_signature(
    file: &Path,
    matter: &str,
    privilege: &str,
    row_count: u32,
    meeting_derived: bool,
) -> Option<manifest::SourceSignature> {
    let (size, mtime_ns) = manifest::stat_signature(file)?;
    Some(manifest::SourceSignature {
        size,
        mtime_ns,
        hash: None,
        extractor_version: manifest::EXTRACTOR_VERSION,
        chunker_version: manifest::CHUNKER_VERSION,
        embedder_version: manifest::EMBEDDER_VERSION.to_string(),
        pdf: None,
        matter_id: matter.to_string(),
        privilege: privilege.to_string(),
        meeting_derived,
        row_count,
        indexed_at: now_unix_secs(),
    })
}

fn text_manifest_entry_is_fresh_for_scope(
    entry: Option<&manifest::SourceSignature>,
    file: &Path,
    matter: &str,
    privilege: &str,
    tombstoned: bool,
) -> bool {
    if tombstoned {
        return false;
    }
    let Some(entry) = entry else {
        return false;
    };
    if entry.matter_id != matter || entry.privilege != privilege {
        return false;
    }
    let Some((size, mtime_ns)) = manifest::stat_signature(file) else {
        return false;
    };
    entry.is_fresh(size, mtime_ns, None)
}

async fn text_manifest_fast_path_can_skip(
    table: &lancedb::Table,
    expected_rows_if_fresh: Option<u32>,
    file: &Path,
    matter: &str,
    privilege: &str,
    key: &[u8; 32],
) -> anyhow::Result<bool> {
    let Some(expected_rows) = expected_rows_if_fresh else {
        return Ok(false);
    };
    store::path_has_expected_rows_for_scope(
        table,
        &file.to_string_lossy(),
        matter,
        privilege,
        expected_rows,
        key,
    )
    .await
}

/// P1.1 — record/refresh a text/office source's manifest signature after a
/// successful single-file index (watcher, matter re-index). Keeps the manifest
/// truthful so a later reconcile can safely skip an unchanged file and re-index a
/// changed one under the RIGHT scope. Best-effort + locked (serialized with the
/// reconcile walk and the PDF path). `row_count` is informational.
async fn record_text_manifest_entry(
    state: &RagState,
    workspace: &Path,
    file: &Path,
    matter: &str,
    privilege: &str,
    row_count: u32,
    meeting_derived: bool,
    key: &[u8; 32],
) {
    let Some(sig) = text_source_signature(
        file,
        matter,
        privilege,
        row_count,
        meeting_derived,
    ) else {
        return;
    };
    // Key by the source's path token (matches the rows; no plaintext path on disk).
    let token = crypto::path_token(key, &file.to_string_lossy());
    let _mg = state.manifest_lock.lock().await;
    let mut m = manifest::load(workspace, store::INDEX_VERSION);
    m.index_version = store::INDEX_VERSION;
    m.insert(token, sig);
    if let Err(e) = manifest::save(workspace, &m) {
        log::warn!("rag: failed to save manifest after single-file index: {e}");
    }
}

#[cfg(test)]
mod qa88_tests {
    use super::*;

    const TEST_KEY: [u8; 32] = [0x42u8; 32];

    #[test]
    fn exact_meeting_manifest_requires_the_current_file_name() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes.docx");
        std::fs::write(&notes, b"notes").unwrap();
        std::fs::write(
            dir.path().join("meeting.json"),
            br#"{"meetingFileVisibility":{"files":{"meeting.json":{},"notes.docx":{}}}}"#,
        )
        .unwrap();
        assert!(exact_meeting_manifest_names_file(&notes));

        let transcript = dir.path().join("transcript.json");
        std::fs::write(&transcript, b"{}").unwrap();
        assert!(!exact_meeting_manifest_names_file(&transcript));

        std::fs::remove_file(dir.path().join("meeting.json")).unwrap();
        assert!(!exact_meeting_manifest_names_file(&notes));
    }

    #[test]
    fn fresh_manifest_entry_same_scope_skips_reindex() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("notes.docx");
        std::fs::write(&file, b"docx bytes").unwrap();
        let sig = text_source_signature(&file, "m-1", store::PRIVILEGE_NONE, 1, false).unwrap();

        assert!(text_manifest_entry_is_fresh_for_scope(
            Some(&sig),
            &file,
            "m-1",
            store::PRIVILEGE_NONE,
            false,
        ));
    }

    #[test]
    fn changed_scope_changed_file_or_tombstone_forces_reindex() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("transcript.json");
        std::fs::write(&file, br#"{"segments":[]}"#).unwrap();
        let sig = text_source_signature(&file, "m-1", store::PRIVILEGE_NONE, 1, false).unwrap();

        assert!(!text_manifest_entry_is_fresh_for_scope(
            Some(&sig),
            &file,
            "m-2",
            store::PRIVILEGE_NONE,
            false,
        ));
        assert!(!text_manifest_entry_is_fresh_for_scope(
            Some(&sig),
            &file,
            "m-1",
            store::PRIVILEGE_NONE,
            true,
        ));

        std::thread::sleep(std::time::Duration::from_millis(5));
        std::fs::write(&file, br#"{"segments":[{"text":"changed"}]}"#).unwrap();

        assert!(!text_manifest_entry_is_fresh_for_scope(
            Some(&sig),
            &file,
            "m-1",
            store::PRIVILEGE_NONE,
            false,
        ));
    }

    #[tokio::test]
    async fn fresh_manifest_entry_without_vector_rows_does_not_skip() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let file = workspace.join("transcript.json");
        std::fs::write(
            &file,
            br#"{"schemaVersion":1,"segments":[{"speaker":"Advisor","text":"portfolio review"}]}"#,
        )
        .unwrap();

        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();

        assert!(
            !text_manifest_fast_path_can_skip(
                &table,
                Some(1),
                &file,
                "m-1",
                store::PRIVILEGE_NONE,
                &TEST_KEY,
            )
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn fresh_manifest_entry_with_partial_vector_rows_does_not_skip() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let file = workspace.join("transcript.json");
        std::fs::write(
            &file,
            br#"{"schemaVersion":1,"segments":[{"speaker":"Advisor","text":"portfolio review"}]}"#,
        )
        .unwrap();

        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let path = file.to_string_lossy().to_string();
        store::upsert_chunks_for_path(
            &table,
            &path,
            vec![(
                chunker::Chunk {
                    path: path.clone(),
                    paragraph_index: 0,
                    text: "portfolio review".to_string(),
                    start_offset: 0,
                    end_offset: 16,
                    locator: None,
                },
                vec![0.1; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            "m-1",
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .unwrap();

        assert!(
            !text_manifest_fast_path_can_skip(
                &table,
                Some(2),
                &file,
                "m-1",
                store::PRIVILEGE_NONE,
                &TEST_KEY,
            )
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn fresh_manifest_entry_with_unknown_row_count_does_not_skip() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let file = workspace.join("transcript.json");
        std::fs::write(
            &file,
            br#"{"schemaVersion":1,"segments":[{"speaker":"Advisor","text":"portfolio review"}]}"#,
        )
        .unwrap();

        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let path = file.to_string_lossy().to_string();
        store::upsert_chunks_for_path(
            &table,
            &path,
            vec![(
                chunker::Chunk {
                    path: path.clone(),
                    paragraph_index: 0,
                    text: "portfolio review".to_string(),
                    start_offset: 0,
                    end_offset: 16,
                    locator: None,
                },
                vec![0.1; embedder::EMBEDDING_DIM],
            )],
            store::SourceType::Text,
            "m-1",
            store::PRIVILEGE_NONE,
            &TEST_KEY,
        )
        .await
        .unwrap();

        assert!(
            !text_manifest_fast_path_can_skip(
                &table,
                Some(0),
                &file,
                "m-1",
                store::PRIVILEGE_NONE,
                &TEST_KEY,
            )
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn fresh_manifest_entry_with_vector_rows_can_skip() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path();
        let file = workspace.join("transcript.json");
        std::fs::write(
            &file,
            br#"{"schemaVersion":1,"segments":[{"speaker":"Advisor","text":"portfolio review"}]}"#,
        )
        .unwrap();

        let conn = store::open_connection(workspace).await.unwrap();
        let table = store::open_or_create_table(&conn).await.unwrap();
        let path = file.to_string_lossy().to_string();
        store::upsert_chunks_for_path(
            &table,
            &path,
            vec![
                (
                    chunker::Chunk {
                        path: path.clone(),
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
                        path: path.clone(),
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

        assert!(
            text_manifest_fast_path_can_skip(
                &table,
                Some(2),
                &file,
                "m-1",
                store::PRIVILEGE_NONE,
                &TEST_KEY,
            )
                .await
                .unwrap()
        );
    }
}

/// P1.1 — update a source's recorded scope in the manifest after an in-place
/// retag (`rag_retag_matter` / `rag_retag_privilege`), so a later reconcile
/// re-indexes a changed file under the CURRENT scope, never a stale one. No-op
/// when the source isn't in the manifest yet (it will pick up the scope when it
/// is first indexed). Best-effort + locked.
pub(crate) async fn update_manifest_scope(
    state: &RagState,
    workspace: &Path,
    path: &str,
    matter: Option<&str>,
    privilege: Option<&str>,
    key: &[u8; 32],
) {
    let token = crypto::path_token(key, path);
    let _mg = state.manifest_lock.lock().await;
    let mut m = manifest::load(workspace, store::INDEX_VERSION);
    let mut changed = false;
    if let Some(sig) = m.sources.get_mut(&token) {
        if let Some(mt) = matter {
            if sig.matter_id != mt {
                sig.matter_id = mt.to_string();
                changed = true;
            }
        }
        if let Some(pv) = privilege {
            if sig.privilege != pv {
                sig.privilege = pv.to_string();
                changed = true;
            }
        }
    }
    if changed {
        if let Err(e) = manifest::save(workspace, &m) {
            log::warn!("rag: failed to save manifest after retag: {e}");
        }
    }
}
