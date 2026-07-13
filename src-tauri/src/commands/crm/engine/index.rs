use super::*;

// ---------------------------------------------------------------------------
// 4. apply_index  (model-gated)
// ---------------------------------------------------------------------------

/// Embed and write a household's [`CrmIndexItem`]s to the RAG index, reusing an
/// already-open LanceDB table and master key.
///
/// This is the performance-critical hot path. Two earlier costs were removed:
///   1. It used to call `index_crm_text_internal` per item, which **opened the
///      LanceDB connection and scanned the table on every record**. The caller
///      ([`backfill`]) now opens the table once and passes it in.
///   2. It used to call `delete_path` **per item** to clear stale chunks — on a
///      ~40-household / ~200-item first sync that was ~200 sequential full-table
///      deletes (each a scan + commit + compaction, all no-ops on a first sync)
///      and never completed. Stale-chunk clearing now happens **per matter** in
///      [`backfill`] (one `delete_crm_for_matters`, only when the matter already has
///      chunks, after the cancel check — a delete-then-insert), NOT per item
///      and NOT one up-front bulk wipe. So this function is a pure insert: chunk →
///      embed (batched per matter) → one `table.add`.
///
/// Requires the embedding model to be loaded (model-gated).
#[allow(dead_code)]
pub async fn apply_index(
    table: &lancedb::Table,
    key: &[u8; 32],
    items: &[CrmIndexItem],
    cancel: &std::sync::atomic::AtomicBool,
) -> anyhow::Result<Option<u32>> {
    use anyhow::Context;
    use std::collections::HashMap;

    if items.is_empty() {
        return Ok(Some(0));
    }

    // Chunk every non-empty item, grouped by matter id. One household maps to one
    // matter, but we group defensively so `build_batch_crm` (which takes a single
    // matter id) always gets a uniform batch.
    let mut by_matter: HashMap<String, Vec<crate::commands::rag::chunker::Chunk>> = HashMap::new();
    for item in items {
        if item.text.trim().is_empty() {
            continue;
        }
        let chunks = crate::commands::rag::chunker::chunk_text(&item.source_id, &item.text);
        if chunks.is_empty() {
            continue;
        }
        by_matter
            .entry(item.matter_id.clone())
            .or_default()
            .extend(chunks);
    }
    if by_matter.is_empty() {
        return Ok(Some(0));
    }

    // For each matter group: embed all its chunks in one batched model call and
    // write them in a single `table.add` (was one add per item).
    let mut total = 0u32;
    for (matter_id, chunks) in by_matter {
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let Some(vectors) = crate::commands::rag::embedder::embed_documents_batched(&texts, Some(cancel))
            .await
            .context("embed crm chunks")? else {
                // `embed_documents_batched` always awaits the active blocking
                // batch before it notices cancellation.  Returning only now
                // means there is no orphaned embedding worker behind this sync.
                return Ok(None);
            };
        if cancel.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(None);
        }
        let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
            chunks.into_iter().zip(vectors).collect();
        if rows.is_empty() {
            continue;
        }
        let batch = crate::commands::rag::store::build_batch_crm(
            &rows,
            key,
            &matter_id,
            crate::commands::rag::store::PRIVILEGE_NONE,
        )
        .context("build crm batch")?;
        let schema = batch.schema();
        use arrow_array::RecordBatchIterator;
        let _write = crate::commands::rag::store::acquire_write_access(table).await?;
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .context("add crm chunks to lancedb")?;
        total += rows.len() as u32;
    }
    Ok(Some(total))
}

// ---------------------------------------------------------------------------
// 5. backfill  (top-level entry point)
// ---------------------------------------------------------------------------

/// Full backfill: ingest all objects from `source`, then index each MATTER in
/// `matter_map` (grouping all of its households together) into the RAG store —
/// one delete + one combined, batched insert per matter.
///
/// `matter_map` is the frontend's household→matter mapping. Usually one household
/// per matter, but a matter may own several; they are grouped so the matter's CRM
/// chunks are replaced as a unit — a delete-then-insert (not once per household,
/// which would wipe siblings). Only matters present in the map are indexed; ingest still stores
/// *all* contacts so the store is a complete snapshot. A matter that previously had
/// CRM chunks but is absent from the map (a re-linked household) has its orphaned
/// chunks purged. Unchanged matters (byte-identical plan) do zero RAG work.
///
/// `cancel` is polled between matters so a long sync can be stopped from the UI;
/// matters already processed stay indexed and `SyncReport::cancelled` is set.
///
/// `rag_key` is the RAG/vector-store master key, supplied by the caller. The
/// command layer reads it from the OS keychain (`get_or_create_master_key`); tests
/// pass a literal key so the real entry point can be driven without a keychain.
///
/// `progress` is updated with the running count of households processed as each matter
/// completes, so a watching `crm_sync_status` (and the progress emitter) sees steady
/// movement during the sync instead of a number that only jumps at the end.
#[allow(dead_code)]
pub async fn backfill(
    source: &dyn CrmSource,
    store: &CrmStore,
    workspace: &Path,
    matter_map: &HashMap<String, String>,
    cancel: &std::sync::atomic::AtomicBool,
    rag_key: &[u8; 32],
    progress: &std::sync::atomic::AtomicU32,
) -> anyhow::Result<SyncReport> {
    use std::sync::atomic::Ordering;

    let mut report = SyncReport::default();
    let provider_id = source.provider_id();
    let provider_matter_map = provider_scoped_matter_map(matter_map, provider_id);

    // Phase 1: ingest everything into the store.
    let Some(ingest_report) = ingest_cancellable(source, store, Some(cancel)).await? else {
        report.cancelled = true;
        return Ok(report);
    };
    report.ingest = ingest_report;

    // Open the RAG connection + table ONCE for the whole sync. Opening the table
    // scans LanceDB, so per-record opens were a dominant cost; one open per sync.
    // We open even when `matter_map` is EMPTY: a re-sync with no CRM links (Wealthbox
    // returned none, or all unlinked) must still purge previously-indexed CRM chunks
    // in the orphan pass below — never leave them searchable.
    let conn = crate::commands::rag::store::open_connection(workspace).await?;
    let table = crate::commands::rag::store::open_or_create_table(&conn).await?;

    // Which matters already have CRM chunks? ONE column-only scan up front. Used to
    // (a) skip the stale-chunk delete for a matter that has none yet — a first sync's
    // deletes are all no-ops, and skipping them removes their commit + compaction churn
    // (the perf cost), and (b) find orphaned matters to purge below.
    let indexed_matters =
        crate::commands::rag::store::list_crm_matters_for_provider(&table, provider_id, rag_key)
            .await?;

    // Group the household→matter map BY MATTER. A matter can own several households,
    // and the old per-household loop deleted the matter's CRM chunks once PER household
    // — each delete wiping the previous household's just-inserted rows (BUG-A: last
    // household wins). Indexing per matter (one delete + one combined batched insert)
    // both fixes that and cuts commits. BTreeMap → deterministic order.
    let mut by_matter: std::collections::BTreeMap<String, Vec<String>> =
        std::collections::BTreeMap::new();
    for (grouping_key, matter_id) in &provider_matter_map {
        by_matter
            .entry(matter_id.clone())
            .or_default()
            .push(grouping_key.clone());
    }
    let synced_matters: std::collections::HashSet<&String> = by_matter.keys().collect();

    let mut did_write = false;

    // Run the index phase in one fallible block so the post-sync `optimize` below runs
    // in a finally-style path even if a delete/embed/add errors — an error must not
    // leave the index bloated. The first error is propagated AFTER the optimize.
    let index_result: anyhow::Result<()> = async {
        // Orphan cleanup (BUG-B + empty-map): a matter that still has CRM chunks but is
        // no longer synced — INCLUDING the empty-map case, where EVERY indexed matter is
        // orphaned — must have its CRM purged (scoped to `source_type='crm'`, so file/mail
        // chunks survive), or its client data stays wrongly retrievable under the old
        // matter. One scoped delete per orphaned matter (none on the happy path).
        for orphan in indexed_matters
            .iter()
            .filter(|m| !synced_matters.contains(m))
        {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }
            // Mark BEFORE the write: a delete that succeeds but errors elsewhere must
            // still trigger the final optimize, or a partial write bloats the index.
            did_write = true;
            crate::commands::rag::store::delete_crm_for_matters_for_provider(
                &table,
                std::slice::from_ref(orphan),
                provider_id,
                rag_key,
            )
            .await?;
        }

        // Phase 2: index each MATTER — plan all its households together, then (only if
        // its plan changed) delete its old CRM chunks and insert the combined, batched
        // fresh plan. This is a delete-then-insert, NOT a real transaction (LanceDB
        // gives none here): cancel is checked BEFORE the delete so a Stop leaves the
        // matter UNCHANGED, and a mid-write error is surfaced (optimize still runs).
        for (matter_id, households) in &by_matter {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }

            // P2.3 row 8: CHEAP change-detection signature FIRST, before any JSON
            // deserialisation or rendering. Built from the stored per-object
            // digests (id + kind + content_hash) across the matter's households,
            // in the same order `plan_household_index` reads them. content_hash is
            // a strong hash of the object JSON, so an unchanged signature means the
            // rendered plan is byte-identical — letting an unchanged matter skip
            // WITHOUT the (previously always-paid) plan+render cost. Cancel is
            // polled per household so a large matter stays responsive to Stop.
            let plan_sig = {
                let mut h = Sha256::new();
                for hk in households {
                    if cancel.load(Ordering::SeqCst) {
                        report.cancelled = true;
                        return Ok(());
                    }
                    for (id, kind, content_hash) in store.list_object_digests_by_household(hk)? {
                        h.update(id.as_bytes());
                        h.update([0]);
                        h.update(kind.as_bytes());
                        h.update([0]);
                        h.update(content_hash.as_bytes());
                        h.update([0]);
                    }
                    // Household boundary so moving an object between households (or
                    // adding/removing a whole household) changes the signature.
                    h.update(b"|hh|");
                    h.update(hk.as_bytes());
                    h.update([0]);
                }
                h.update(matter_id.as_bytes());
                hex::encode(h.finalize())
            };

            report.households_processed += households.len() as u32;
            // Publish live progress as each matter is reached (steady movement for a
            // watching crm_sync_status / progress emitter).
            progress.store(report.households_processed, Ordering::SeqCst);

            let already_indexed = indexed_matters.contains(matter_id.as_str());

            // Unchanged-skip: byte-identical plan signature + chunks already present
            // → ZERO RAG work AND zero deserialise/render. (Guarded on actual-chunk
            // presence too, so a stale render row can never cause an incorrect skip.)
            if already_indexed {
                if let Some((prev_hash, true)) = store.get_render_state(matter_id)? {
                    if prev_hash == plan_sig {
                        continue;
                    }
                }
            }

            // Changed (or first sync): NOW pay the plan+render. Poll cancel inside
            // the loop so a large multi-household matter stays responsive to Stop.
            let mut items: Vec<CrmIndexItem> = Vec::new();
            for hk in households {
                if cancel.load(Ordering::SeqCst) {
                    report.cancelled = true;
                    return Ok(());
                }
                items.extend(plan_household_index(store, hk, matter_id)?);
            }

            // Cancel right before the expensive delete + embed, so a Stop on a large
            // matter leaves it UNCHANGED (nothing deleted, nothing inserted).
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(());
            }

            // Delete only when the matter actually has stale chunks (never on a first
            // sync — that no-op-delete churn is what we removed). Set `did_write` BEFORE
            // each LanceDB write so a partial write (delete ok then add fails, or add ok
            // then render-state write fails) still triggers the finally-style optimize.
            if already_indexed {
                did_write = true;
                crate::commands::rag::store::delete_crm_for_matters_for_provider(
                    &table,
                    std::slice::from_ref(matter_id),
                    provider_id,
                    rag_key,
                )
                .await?;
            }
            if !items.is_empty() {
                did_write = true;
                let Some(indexed) = apply_index(&table, rag_key, &items, cancel).await? else {
                    report.cancelled = true;
                    return Ok(());
                };
                report.records_indexed += indexed;
            }
            store.set_render_state(matter_id, &plan_sig, true)?;
        }

        Ok(())
    }
    .await;

    // Finally: ONE optimize at the end (deferred compaction — perf), regardless of
    // whether the index phase errored, so an error never leaves the index bloated.
    // Best-effort: a failure here never fails the sync.
    if did_write {
        if let Err(e) = crate::commands::rag::store::optimize_after_bulk_write(&table).await {
            log::warn!("crm post-sync optimize failed (non-fatal): {e:#}");
        }
    }

    // Propagate the first index-phase error (if any) AFTER the optimize ran.
    index_result?;

    Ok(report)
}
