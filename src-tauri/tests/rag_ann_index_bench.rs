//! P2.1 (Finding 1) — flat-scan vs ANN (IVF_FLAT) benchmark + correctness gate,
//! and the batch-citation-verify (Finding 2) before/after measurement.
//!
//! WHY THIS EXISTS. The Ask latency investigation flagged that retrieval does a
//! brute-force flat scan of the whole `chunks` table (no ANN index), so latency
//! grows linearly with corpus size — fine for a few thousand chunks, painful once
//! an advisor has tens/hundreds of thousands. This bench builds a realistic 60k+
//! chunk corpus with RANDOM vectors (timing scales with row count regardless of
//! whether vectors are "real"), then measures:
//!
//!   1. `nearest()` latency FLAT vs after `store::create_vector_index` — scoped
//!      (one matter) and unscoped (all matters).
//!   2. RECALL of the ANN index vs the exact flat scan (flat IS ground truth), so
//!      we ship the index only if it wins on latency WITHOUT wrecking recall.
//!   3. ISOLATION still holds WITH the index: every scoped hit is in scope. This
//!      is the risk point the plan calls out — an ANN index must never let a
//!      Matter-B chunk surface under a Matter-A query. (The prefilter runs before
//!      the vector search either way, so this should hold; the test proves it.)
//!   4. The retrieve→verify PIPELINE end to end (nearest + verify the top-k),
//!      flat vs indexed.
//!   5. Batch citation verify (`fetch_records_by_ids`, ONE query) vs the old N+1
//!      (`lookup_by_id` per citation).
//!
//! No embedder / model needed — vectors are random. Heavy + slow, so `#[ignore]`.
//! Run explicitly to see the BEFORE/AFTER table:
//!
//!   cargo test --test rag_ann_index_bench -- --ignored --nocapture

use std::collections::HashSet;
use std::time::Instant;

use arrow_array::RecordBatchIterator;
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

use lantern_lib::commands::rag::chunker::Chunk;
use lantern_lib::commands::rag::store::{
    self, SourceType, PRIVILEGE_NONE,
};

/// Fixed vector-store key (chunk text is encrypted at rest exactly as prod does).
const TEST_KEY: [u8; 32] = [0x24u8; 32];

const EMBEDDING_DIM: usize = 384;

/// Corpus knobs. 60k chunks is comfortably past `VECTOR_INDEX_MIN_ROWS` (25k) so
/// the index actually builds, and big enough that the flat-scan cost is visible.
const N_CHUNKS: usize = 60_000;
const N_MATTERS: usize = 30;
const TOP_K: usize = 10;
const N_QUERIES: usize = 25;

fn random_vec(rng: &mut StdRng) -> Vec<f32> {
    (0..EMBEDDING_DIM).map(|_| rng.gen_range(-1.0..1.0)).collect()
}

fn matter_id(m: usize) -> String {
    format!("bench-matter-{m:03}")
}

/// Insert `N_CHUNKS` chunks spread across `N_MATTERS`, each a single-chunk doc
/// with a random vector. Returns the per-row (id, matter, vector) so the bench
/// can pick real ids for verification and (if needed) reason about ground truth.
async fn build_corpus(
    table: &lancedb::Table,
) -> Vec<(String, String, Vec<f32>)> {
    let mut rng = StdRng::seed_from_u64(0xC0FFEE);
    // Group rows by matter so each `build_batch` call carries one matter id.
    let mut by_matter: Vec<Vec<(Chunk, Vec<f32>)>> = vec![Vec::new(); N_MATTERS];
    let mut meta: Vec<(String, String, Vec<f32>)> = Vec::with_capacity(N_CHUNKS);

    for i in 0..N_CHUNKS {
        let m = i % N_MATTERS;
        let path = format!("bench/m{m:03}/doc{i:06}.txt");
        let vector = random_vec(&mut rng);
        let id = store::chunk_id(&path, 0);
        meta.push((id, matter_id(m), vector.clone()));
        let text = format!(
            "Benchmark chunk {i} for matter {m}. Retirement allocation, Roth \
             conversion timeline, quarterly rebalancing. Unique marker {i}."
        );
        by_matter[m].push((
            Chunk {
                path,
                paragraph_index: 0,
                text,
                start_offset: 0,
                end_offset: 0,
                locator: None,
            },
            vector,
        ));
    }

    let schema = store::build_schema();
    for (m, rows) in by_matter.into_iter().enumerate() {
        // Add in sub-batches to bound peak memory (encrypt + Arrow build).
        for slice in rows.chunks(5_000) {
            let batch = store::build_batch(
                slice,
                SourceType::Text,
                &matter_id(m),
                PRIVILEGE_NONE,
                None,
                &TEST_KEY,
            )
            .expect("build_batch");
            table
                .add(Box::new(RecordBatchIterator::new(
                    vec![Ok(batch)],
                    schema.clone(),
                )))
                .execute()
                .await
                .expect("add batch");
        }
    }
    meta
}

/// Run `N_QUERIES` scoped + unscoped nearest() queries, returning per-query top-k
/// id sets (for recall) and the total elapsed time. `scope` None = unscoped.
async fn time_queries(
    table: &lancedb::Table,
    queries: &[Vec<f32>],
    scope: Option<&str>,
) -> (Vec<HashSet<String>>, std::time::Duration) {
    let mut per_query_ids: Vec<HashSet<String>> = Vec::with_capacity(queries.len());
    let start = Instant::now();
    for q in queries {
        let hits = store::nearest(table, q, TOP_K, scope, false, &[])
            .await
            .expect("nearest");
        // Isolation check WITH whatever index state we're in: a scoped query must
        // never return an out-of-scope matter.
        if let Some(s) = scope {
            for h in &hits {
                assert_eq!(
                    h.matter_id.as_deref(),
                    Some(s),
                    "ISOLATION VIOLATION: scoped query returned matter {:?} under scope {s}",
                    h.matter_id
                );
            }
        }
        per_query_ids.push(hits.into_iter().map(|h| h.id).collect());
    }
    (per_query_ids, start.elapsed())
}

fn mean_recall(flat: &[HashSet<String>], ann: &[HashSet<String>]) -> f64 {
    assert_eq!(flat.len(), ann.len());
    let mut total = 0.0;
    for (f, a) in flat.iter().zip(ann) {
        if f.is_empty() {
            continue;
        }
        let hit = f.intersection(a).count() as f64;
        total += hit / (f.len() as f64);
    }
    total / (flat.len() as f64)
}

#[tokio::test]
#[ignore]
async fn ann_index_vs_flat_scan_bench() {
    let tmp = tempfile::TempDir::new().unwrap();
    let conn = store::open_connection(tmp.path()).await.unwrap();
    let table = store::open_or_create_table(&conn).await.unwrap();

    eprintln!("[bench] inserting {N_CHUNKS} chunks across {N_MATTERS} matters…");
    let t0 = Instant::now();
    let meta = build_corpus(&table).await;
    eprintln!("[bench] corpus built in {:.1}s", t0.elapsed().as_secs_f64());

    // Fixed query set (deterministic) for a fair flat-vs-ANN comparison.
    let mut qrng = StdRng::seed_from_u64(0xBEEF);
    let queries: Vec<Vec<f32>> = (0..N_QUERIES).map(|_| random_vec(&mut qrng)).collect();
    let scope = matter_id(0);

    // ---- BEFORE: flat scan (exact — this is the recall ground truth) ----------
    let (flat_scoped_ids, flat_scoped_t) = time_queries(&table, &queries, Some(&scope)).await;
    let (flat_unscoped_ids, flat_unscoped_t) = time_queries(&table, &queries, None).await;

    // ---- Build the ANN index --------------------------------------------------
    eprintln!("[bench] building IVF_FLAT index…");
    let ti = Instant::now();
    let built = store::ensure_vector_index_after_bulk(&table).await.unwrap();
    assert!(built, "corpus of {N_CHUNKS} must exceed VECTOR_INDEX_MIN_ROWS");
    eprintln!("[bench] index built in {:.1}s", ti.elapsed().as_secs_f64());

    // ---- AFTER: indexed scan --------------------------------------------------
    let (ann_scoped_ids, ann_scoped_t) = time_queries(&table, &queries, Some(&scope)).await;
    let (ann_unscoped_ids, ann_unscoped_t) = time_queries(&table, &queries, None).await;

    let scoped_recall = mean_recall(&flat_scoped_ids, &ann_scoped_ids);
    let unscoped_recall = mean_recall(&flat_unscoped_ids, &ann_unscoped_ids);

    // ---- Batch verify (Finding 2): pick 8 real ids from matter 0 --------------
    let sample_ids: Vec<String> = meta
        .iter()
        .filter(|(_, m, _)| *m == scope)
        .take(8)
        .map(|(id, _, _)| id.clone())
        .collect();
    // OLD path: one lookup_by_id per citation (scoped), plus a fallback lookup.
    let told = Instant::now();
    for _ in 0..N_QUERIES {
        for id in &sample_ids {
            let _ = store::lookup_by_id(&table, id, Some(&scope)).await.unwrap();
        }
    }
    let old_verify_t = told.elapsed();
    // NEW path: one fetch_records_by_ids for the whole citation set.
    let tnew = Instant::now();
    for _ in 0..N_QUERIES {
        let _ = store::fetch_records_by_ids(&table, &sample_ids).await.unwrap();
    }
    let new_verify_t = tnew.elapsed();

    let per = |d: std::time::Duration| d.as_secs_f64() * 1000.0 / (N_QUERIES as f64);
    eprintln!("\n================ P2.1 RAG retrieval bench ({N_CHUNKS} chunks) ================");
    eprintln!("nearest() SCOPED   flat {:8.2} ms/q  ->  ann {:8.2} ms/q   recall {:.3}",
        per(flat_scoped_t), per(ann_scoped_t), scoped_recall);
    eprintln!("nearest() UNSCOPED flat {:8.2} ms/q  ->  ann {:8.2} ms/q   recall {:.3}",
        per(flat_unscoped_t), per(ann_unscoped_t), unscoped_recall);
    eprintln!("verify {} cites    N+1 lookup {:8.2} ms  ->  batch {:8.2} ms  (store-level; the",
        sample_ids.len(), per(old_verify_t), per(new_verify_t));
    eprintln!("  bigger batch win is command-level: ONE table open for all cites, not N)");
    eprintln!("index build: {:.1}s", ti.elapsed().as_secs_f64());
    eprintln!("----------------------------------------------------------------------------");
    let ann_wins = per(ann_unscoped_t) < per(flat_unscoped_t) && unscoped_recall >= 0.90;
    eprintln!(
        "CONCLUSION: at {N_CHUNKS} chunks the flat scan {} — {}",
        if ann_wins { "loses to ANN" } else { "WINS (faster and exact)" },
        if ann_wins {
            "consider enabling the index".to_string()
        } else {
            format!(
                "keep flat (ANN {:.0} ms/q vs flat {:.0} ms/q, ANN recall {:.2})",
                per(ann_unscoped_t), per(flat_unscoped_t), unscoped_recall
            )
        }
    );
    eprintln!("============================================================================\n");

    // ---- ROBUST INVARIANTS (these MUST hold regardless of the perf verdict) ---
    // 1. ISOLATION with the index. `time_queries` already asserts every scoped hit
    //    is in-scope on BOTH the flat and the indexed passes; reaching here means
    //    the ANN index never leaked a Matter-B chunk under a Matter-A query — the
    //    plan's risk point. Assert it explicitly for the record.
    assert!(
        ann_scoped_ids.iter().all(|s| !s.is_empty()),
        "scoped indexed queries must still return in-scope hits"
    );
    // 2. The index builds and is usable (already asserted via `built`). We do NOT
    //    assert a recall/latency threshold: this is a MEASUREMENT that drives the
    //    ship/no-ship decision (currently: don't ship — flat wins), not a CI gate.
    //    Random vectors have no cluster structure, so IVF recall here is a floor,
    //    not a verdict on real embeddings; the LATENCY result (flat is faster at
    //    this scale) is what settles it.
}
