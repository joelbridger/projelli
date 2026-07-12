use super::*;
use std::collections::HashSet;

/// Compact data fragments and prune old versions in ONE pass. Called once at the
/// END of a CRM sync so the per-matter appends don't drive per-household compaction
/// churn during the run (the "Auto cleanup every ~30s" the bench observed). Failure
/// must NOT fail the sync — call sites treat it as best-effort.
pub async fn optimize_after_bulk_write(table: &Table) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    table
        .optimize(lancedb::table::OptimizeAction::All)
        .await
        .context("optimize crm table after bulk write")?;
    Ok(())
}

/// P2.1 (Finding 1) — corpus size at/above which the ANN-index tooling below is
/// even considered. NOTE: the ANN index is NOT auto-enabled — the benchmark
/// (`tests/rag_ann_index_bench.rs`) showed the brute-force flat scan WINS at
/// realistic advisor scale (~73–92 ms/query at 60k, and EXACT), while IVF_FLAT
/// was slower there and lossy on recall. This constant + `create_vector_index`
/// are retained as benched tooling for a future revisit at 500k+ chunks (where
/// flat becomes seconds), pending real-embedding recall validation.
pub const VECTOR_INDEX_MIN_ROWS: usize = 25_000;

/// P2.1 (Finding 1) — (re)build the IVF_FLAT ANN index on the `vector` column.
/// NOT auto-called in production (see `VECTOR_INDEX_MIN_ROWS` and the bench);
/// exercised by the benchmark and available for a future large-corpus revisit.
///
/// IVF_FLAT keeps FULL-PRECISION vectors (no product quantization): distances
/// stay exact and only candidate SELECTION is approximate — the right trade for a
/// recall-sensitive advisory corpus (IVF_PQ would compress vectors and blur
/// distances). `L2` matches the query metric (`nearest_to` defaults to L2).
///
/// ISOLATION IS UNAFFECTED. The matter/privilege/tombstone predicate is applied
/// as a PREFILTER (`only_if`, prefilter defaults to true) BEFORE the vector
/// search whether or not an index exists, so a scoped query still searches only
/// in-scope rows. An index can change RECALL (which in-scope chunks surface),
/// never SCOPE (which matters are visible). The isolation tests run on small
/// corpora that stay under `VECTOR_INDEX_MIN_ROWS` (flat path), and this function
/// changes neither the schema nor the prefilter.
///
/// Idempotent: re-running replaces the index. Rows added AFTER a build are a
/// flat-scanned unindexed delta until the next rebuild/optimize, so results are
/// always correct (never stale), only the delta is slower.
pub async fn create_vector_index(table: &Table) -> Result<()> {
    let _write = acquire_write_access(table).await?;
    use lancedb::index::vector::IvfFlatIndexBuilder;
    use lancedb::index::Index;
    use lancedb::DistanceType;
    table
        .create_index(
            &["vector"],
            Index::IvfFlat(IvfFlatIndexBuilder::default().distance_type(DistanceType::L2)),
        )
        .execute()
        .await
        .context("create IVF_FLAT vector index on chunks.vector")?;
    Ok(())
}

/// P2.1 (Finding 1) — after a bulk FULL index walk, build the ANN index IFF the
/// corpus is large enough to benefit (`VECTOR_INDEX_MIN_ROWS`). Returns whether an
/// index was (re)built (for logging / the bench). Callers treat a failure as
/// best-effort: retrieval falls back to the exact flat scan, so an index failure
/// must never fail indexing.
pub async fn ensure_vector_index_after_bulk(table: &Table) -> Result<bool> {
    let rows = table
        .count_rows(None)
        .await
        .context("count_rows for vector-index gate")?;
    if rows < VECTOR_INDEX_MIN_ROWS {
        return Ok(false);
    }
    create_vector_index(table).await?;
    Ok(true)
}

/// Return how many vector rows currently exist for `path` under the given scope.
///
/// The manifest is only a saved receipt. Before a caller skips indexing from
/// that receipt, it must also prove the actual vector rows are still present
/// for the same matter/privilege scope.
pub async fn path_row_count_for_scope(
    table: &Table,
    path: &str,
    matter_id: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<usize> {
    let matter_id = validate_matter_id(matter_id)?;
    let privilege = validate_privilege(privilege)?;
    let predicate = format!(
        "path = '{}' AND matter_id = '{}' AND privilege = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path)),
        sql_escape(matter_id),
        sql_escape(privilege),
    );
    table
        .count_rows(Some(predicate))
        .await
        .with_context(|| format!("count rows for {}", path))
}

/// Return whether the vector table has enough rows to trust a fresh manifest.
///
/// `expected_rows == 0` is treated as unknown, not trusted: older single-file
/// manifest writes stored 0 for non-empty files, so a zero-count receipt cannot
/// prove that all rows survived. Re-index instead of silently missing chunks.
pub async fn path_has_expected_rows_for_scope(
    table: &Table,
    path: &str,
    matter_id: &str,
    privilege: &str,
    expected_rows: u32,
    key: &[u8; 32],
) -> Result<bool> {
    let rows = path_row_count_for_scope(table, path, matter_id, privilege, key).await?;
    if expected_rows == 0 {
        return Ok(false);
    }
    Ok(rows >= expected_rows as usize)
}

/// QA-92 — one column-only scan returning, per `(path-token, matter_id,
/// privilege)`, how many vector rows currently exist. The boot reconcile uses
/// this to prove a manifest "fresh" entry's rows REALLY exist under its recorded
/// scope before it SKIPS the file — WITHOUT firing a per-file `count_rows` query
/// for every unchanged file (which, on a warm boot of a large workspace, is a
/// per-file full-table scan flood). `path` stores the HMAC path token (the same
/// value a manifest key carries); `matter_id`/`privilege` are the plaintext
/// scope columns. Pre-computed once, it turns each skip's row-proof into an O(1)
/// in-memory lookup.
pub async fn scoped_row_counts(
    table: &Table,
) -> Result<std::collections::HashMap<(String, String, String), usize>> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .select(Select::columns(&["path", "matter_id", "privilege"]))
        .execute()
        .await
        .context("scoped_row_counts query execute failed")?;

    let mut counts: std::collections::HashMap<(String, String, String), usize> =
        std::collections::HashMap::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("scoped_row_counts stream try_next failed")?
    {
        let path = batch
            .column_by_name("path")
            .context("missing path column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path column is not StringArray")?;
        let matter = batch
            .column_by_name("matter_id")
            .context("missing matter_id column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("matter_id column is not StringArray")?;
        let privilege = batch
            .column_by_name("privilege")
            .context("missing privilege column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("privilege column is not StringArray")?;
        for i in 0..path.len() {
            if path.is_null(i) || matter.is_null(i) || privilege.is_null(i) {
                continue;
            }
            *counts
                .entry((
                    path.value(i).to_string(),
                    matter.value(i).to_string(),
                    privilege.value(i).to_string(),
                ))
                .or_insert(0) += 1;
        }
    }
    Ok(counts)
}

/// QA-92 (round 2) — return which of `paths` have NO vector rows under
/// `matter_id` right now (any privilege). Called right after a batched matter
/// retag to find the files whose rows did NOT move to the target scope — a
/// never-indexed file, or a path-form mismatch — so the caller can re-index
/// EXACTLY those. The single aggregate rows-updated count from the batch cannot
/// reveal this: in a MIXED batch (e.g. a client folder holding a retaggable
/// `plan.docx` plus a zero-row `statement.pdf`) the count is > 0, so the miss
/// hides and that one file stays unassigned and invisible to client-scoped Ask.
/// ONE column scan filtered to the target matter → O(1) membership per path.
pub async fn paths_missing_rows_under_matter(
    table: &Table,
    paths: &[String],
    matter_id: &str,
    key: &[u8; 32],
) -> Result<Vec<String>> {
    use futures_util::TryStreamExt;
    let matter_id = validate_matter_id(matter_id)?;
    // ONE column-only scan of the rows currently under the target matter,
    // projecting the tokenized `path` column into a membership set.
    let predicate = format!("matter_id = '{}'", sql_escape(matter_id));
    let mut stream = table
        .query()
        .only_if(predicate)
        .select(Select::columns(&["path"]))
        .execute()
        .await
        .context("paths_missing_rows_under_matter query execute failed")?;
    let mut present: HashSet<String> = HashSet::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("paths_missing_rows_under_matter stream try_next failed")?
    {
        let col = batch
            .column_by_name("path")
            .context("missing path column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path column is not StringArray")?;
        for i in 0..col.len() {
            if !col.is_null(i) {
                present.insert(col.value(i).to_string());
            }
        }
    }
    // A path is a miss iff NONE of its rows are present under the target matter.
    Ok(paths
        .iter()
        .filter(|p| !present.contains(&super::super::crypto::path_token(key, p)))
        .cloned()
        .collect())
}

/// WS-PRIV — re-tag the privilege of every already-indexed chunk for `path`
/// IN PLACE, without re-embedding. Used when the user toggles a source's
/// privilege: the chunk text + vectors are unchanged, only the `privilege`
/// column flips, which is exactly what changes whether the chunk is excluded
/// from default retrieval.
///
/// Implemented as a LanceDB `UPDATE ... WHERE path = ?` so it is cheap and does
/// not touch the embedder. The new value is validated against the three known
/// privilege values (defence-in-depth) and SQL-escaped both as the SET literal
/// and in the WHERE clause. Returns the number of rows updated.
///
/// Note: a source that has not been indexed yet has zero chunks; this returns 0
/// and the source picks up the right privilege when it is next indexed (the
/// privilege store is the source of truth and the index resolver reads it).
pub async fn retag_privilege_for_path(
    table: &Table,
    path: &str,
    privilege: &str,
    key: &[u8; 32],
) -> Result<u64> {
    let _write = acquire_write_access(table).await?;
    let privilege = validate_privilege(privilege)?;
    // VG-6e: tokenized predicate — the column holds the keyed token.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path))
    );
    // The update expression is a SQL string literal for the new privilege value.
    let value_expr = format!("'{}'", sql_escape(privilege));
    let result = table
        .update()
        .only_if(predicate)
        .column("privilege", value_expr)
        .execute()
        .await
        .with_context(|| format!("retag privilege failed for {}", path))?;
    Ok(result.rows_updated)
}

/// WS-B/C — re-tag the matter of every already-indexed chunk for `path` IN
/// PLACE, without re-embedding. The mirror of `retag_privilege_for_path` for the
/// matter scope: used when a source's matter assignment changes (e.g. a mail
/// folder is mapped to a different matter) so retrieval scoping updates without
/// re-running the embedder. The chunk text + vectors are unchanged; only the
/// `matter_id` column flips, which is exactly what changes which matter scope the
/// chunk surfaces under.
///
/// `matter_id` is validated (non-empty; `UNASSIGNED_MATTER` is allowed) and
/// SQL-escaped both as the SET literal and in the WHERE clause. Returns the
/// number of rows updated (0 when the source has not been indexed yet — it will
/// pick up the right matter when next indexed, since the index path resolves the
/// matter at index time).
pub async fn retag_matter_for_path(
    table: &Table,
    path: &str,
    matter_id: &str,
    key: &[u8; 32],
) -> Result<u64> {
    let _write = acquire_write_access(table).await?;
    let matter_id = validate_matter_id(matter_id)?;
    // VG-6e: tokenized predicate — the column holds the keyed token.
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path))
    );
    let value_expr = format!("'{}'", sql_escape(matter_id));
    let result = table
        .update()
        .only_if(predicate)
        .column("matter_id", value_expr)
        .execute()
        .await
        .with_context(|| format!("retag matter failed for {}", path))?;
    Ok(result.rows_updated)
}

/// P1.1 — BATCHED `retag_matter_for_path`: re-tag every chunk of ANY path in
/// `paths` to `matter_id` in ONE LanceDB UPDATE per chunk (`path IN (…tokens)`).
///
/// Why batched: LanceDB rewrites data on each UPDATE, so a per-file loop over N
/// files is ~N full rewrites — measured at ~0.5 s/file (≈ the re-embed cost it
/// was meant to avoid). Collapsing the boot retag of a mapped folder into a
/// single UPDATE turns that into one rewrite. The IN-list is chunked so a huge
/// workspace can't build an unbounded predicate string. Returns rows updated;
/// empty `paths` is a no-op. Same tokenized predicate + validation as the
/// single-path version.
pub const RETAG_MATTER_PATHS_PER_UPDATE: usize = 512;

#[cfg(test)]
tokio::task_local! {
    static RETAG_MATTER_TABLE_UPDATE_COUNTER: std::sync::Arc<std::sync::atomic::AtomicUsize>;
}

fn retag_matter_path_batches(paths: &[String]) -> impl Iterator<Item = &[String]> {
    paths.chunks(RETAG_MATTER_PATHS_PER_UPDATE)
}

pub async fn retag_matter_for_paths(
    table: &Table,
    paths: &[String],
    matter_id: &str,
    key: &[u8; 32],
) -> Result<u64> {
    if paths.is_empty() {
        return Ok(0);
    }
    let _write = acquire_write_access(table).await?;
    let matter_id = validate_matter_id(matter_id)?;
    let value_expr = format!("'{}'", sql_escape(matter_id));
    let mut total = 0u64;
    for chunk in retag_matter_path_batches(paths) {
        let tokens: Vec<String> = chunk
            .iter()
            .map(|p| format!("'{}'", sql_escape(&super::super::crypto::path_token(key, p))))
            .collect();
        let predicate = format!(
            "path IN ({}) AND matter_id <> {}",
            tokens.join(", "),
            value_expr
        );
        #[cfg(test)]
        let _ = RETAG_MATTER_TABLE_UPDATE_COUNTER.try_with(|counter| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        });
        let result = table
            .update()
            .only_if(predicate)
            .column("matter_id", value_expr.clone())
            .execute()
            .await
            .with_context(|| format!("batched retag matter failed for {} paths", chunk.len()))?;
        total += result.rows_updated;
    }
    Ok(total)
}

/// Count distinct sources that have indexed rows whose current matter differs
/// from `matter_id`. This keeps folder remaps returning the old useful count:
/// messages changed, not selected messages or changed chunk rows.
pub async fn count_paths_requiring_matter_retag(
    table: &Table,
    paths: &[String],
    matter_id: &str,
    key: &[u8; 32],
) -> Result<u32> {
    use futures_util::TryStreamExt;

    if paths.is_empty() {
        return Ok(0);
    }
    let matter_id = validate_matter_id(matter_id)?;
    let value_expr = format!("'{}'", sql_escape(matter_id));
    let mut changed = HashSet::new();
    for chunk in retag_matter_path_batches(paths) {
        let tokens: Vec<String> = chunk
            .iter()
            .map(|path| super::super::crypto::path_token(key, path))
            .collect();
        let predicate_tokens: Vec<String> = tokens
            .iter()
            .map(|token| format!("'{}'", sql_escape(token)))
            .collect();
        let predicate = format!(
            "path IN ({}) AND matter_id <> {}",
            predicate_tokens.join(", "),
            value_expr
        );
        let mut stream = table
            .query()
            .only_if(predicate)
            .select(Select::columns(&["path"]))
            .execute()
            .await
            .context("count retag paths query execute failed")?;
        while let Some(batch) = stream
            .try_next()
            .await
            .context("count retag paths stream failed")?
        {
            let Some(column) = batch
                .column_by_name("path")
                .and_then(|column| column.as_any().downcast_ref::<StringArray>())
            else {
                continue;
            };
            for index in 0..column.len() {
                if !column.is_null(index) {
                    changed.insert(column.value(index).to_string());
                }
            }
        }
    }
    Ok(changed.len() as u32)
}

#[cfg(test)]
mod batch_tests {
    use super::*;

    #[test]
    fn mail_sized_retag_uses_one_vector_table_update() {
        let paths: Vec<String> = (0..450).map(|id| format!("mail:{id}")).collect();
        assert_eq!(retag_matter_path_batches(&paths).count(), 1);
    }

    #[test]
    fn retag_update_count_is_ceiling_of_512_id_chunks() {
        for count in [0usize, 1, 512, 513, 1024, 1025] {
            let paths: Vec<String> = (0..count).map(|id| format!("mail:{id}")).collect();
            assert_eq!(retag_matter_path_batches(&paths).count(), count.div_ceil(RETAG_MATTER_PATHS_PER_UPDATE));
        }
    }

    #[tokio::test]
    async fn counter_observes_real_lancedb_update_calls_at_the_write_choke_point() {
        let dir = tempfile::TempDir::new().unwrap();
        let conn = crate::commands::rag::store::open_connection(dir.path()).await.unwrap();
        let table = crate::commands::rag::store::open_or_create_table(&conn).await.unwrap();
        let key = [0x5Au8; 32];

        let counter = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let paths: Vec<String> = (0..513).map(|id| format!("mail:{id}")).collect();
        RETAG_MATTER_TABLE_UPDATE_COUNTER
            .scope(counter.clone(), async {
                retag_matter_for_paths(&table, &paths, "matter-acme", &key)
                    .await
                    .unwrap();
            })
            .await;

        assert_eq!(
            counter.load(std::sync::atomic::Ordering::SeqCst),
            2,
            "the counter sits beside Table::update(), so this proves the actual LanceDB writes"
        );
    }
}

/// Read the matter scope a given source path is currently filed under, by
/// querying the tokenized `path` column and returning the chunk's `matter_id`.
///
/// Mirrors `retag_matter_for_path`'s tokenized predicate (the `path` column
/// holds the keyed token, not the plaintext path — VG-6e). Scans EVERY chunk
/// for the path rather than one arbitrary row, so a robust answer is returned
/// even if chunks somehow disagree: returns `Ok(Some(matter))` when all
/// non-empty chunks agree on one matter, `Ok(None)` when the path has no
/// indexed chunk (or only empty matters), and `Ok(None)` (with a warning) when
/// chunks disagree — never an arbitrary/ambiguous pick.
///
/// BUG-013: used as the SOFT folder-level fallback when a message has no durable
/// per-message override; the unassigned sentinel is filtered by the caller.
pub async fn matter_for_path(table: &Table, path: &str, key: &[u8; 32]) -> Result<Option<String>> {
    use futures_util::TryStreamExt;
    let predicate = format!(
        "path = '{}'",
        sql_escape(&super::super::crypto::path_token(key, path))
    );
    let mut stream = table
        .query()
        .only_if(predicate)
        .select(Select::columns(&["matter_id"]))
        .execute()
        .await
        .context("matter_for_path query execute failed")?;

    let mut found: Option<String> = None;
    while let Some(batch) = stream
        .try_next()
        .await
        .context("matter_for_path stream try_next failed")?
    {
        let Some(col) = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        else {
            continue;
        };
        for i in 0..col.len() {
            if col.is_null(i) {
                continue;
            }
            let v = col.value(i);
            if v.is_empty() {
                continue;
            }
            match &found {
                None => found = Some(v.to_string()),
                Some(existing) if existing == v => {}
                Some(existing) => {
                    log::warn!(
                        "matter_for_path: chunks for {path} disagree ({existing} vs {v}); \
                         treating as indeterminate"
                    );
                    return Ok(None);
                }
            }
        }
    }
    Ok(found)
}
