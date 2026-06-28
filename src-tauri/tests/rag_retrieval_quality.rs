//! WS3b — RETRIEVAL-QUALITY baseline against the REAL shipped stack.
//!
//! This is the honest measurement baseline a future retrieval reranker must
//! BEAT. It runs the SAME LanceDB + fastembed e5-small engine the app ships
//! (mirroring `rag_matter_scope.rs`) over the SHARED eval corpus at
//! `tests/eval/ask/corpus/` — the same `*.md` files and `manifest.json` the
//! TypeScript Ask eval uses — and measures how well retrieval ranks the RIGHT
//! source document for a set of natural-language queries.
//!
//! The corpus is deliberately adversarial: two confusable clients ("Marcus
//! Johnson" vs "Marcus Johnston") with conflicting parallel facts, a confusable
//! company ("Nexus Diagnostics" vs "Nexus Dynamics"), and rare long-tail
//! keywords ("Telomere Assay Confidentiality Rider", "TA-204"). Most queries run
//! UNSCOPED so the embedding — not a matter prefilter — must disambiguate; this
//! is what catches "retrieved the wrong client's document" regressions.
//!
//! Metrics (binary relevance, source-document granularity): MRR, NDCG@5,
//! Precision@{1,3,5}, Hit@{1,3,5}. They are PRINTED and written to
//! `tests/eval/ask/results/retrieval-latest.json` (gitignored). The committed
//! `tests/eval/ask/retrieval-baseline.json` is the frozen reference snapshot.
//!
//! MODEL: like the other RAG integration tests this SKIPS when the e5-small
//! cache is absent (CI), and `REQUIRE_RAG_MODEL=1` turns a missing model into a
//! hard failure instead of a silent skip. Run it for real with:
//!   REQUIRE_RAG_MODEL=1 cargo test -p keepance --test rag_retrieval_quality -- --nocapture

use keepance_lib::commands::rag::chunker::Chunk;
use keepance_lib::commands::rag::store::{self, SourceType, PRIVILEGE_NONE};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Fixed vector-store key so the test never touches the OS keychain. WS-VEC:
/// every chunk's `text`/`path` column is ciphertext under this key.
const VEC_KEY: [u8; 32] = [0x5Au8; 32];

/// Returns true when the e5-small model cache is provisioned (same resolution as
/// the production embedder).
fn model_is_provisioned() -> bool {
    use keepance_lib::commands::rag::embedder::resolve_cache_dir;
    use keepance_lib::commands::rag::model_download::model_files_cached;
    model_files_cached(&resolve_cache_dir())
}

macro_rules! skip_without_model {
    () => {
        if !model_is_provisioned() {
            if std::env::var("REQUIRE_RAG_MODEL").ok().filter(|v| !v.is_empty()).is_some() {
                panic!(
                    "REQUIRE_RAG_MODEL set but e5-small cache missing — \
                     refusing to silently skip the retrieval-quality baseline"
                );
            }
            eprintln!(
                "SKIP {}: e5-small model cache not provisioned \
                 (expected on CI; runs locally/nightly)",
                module_path!()
            );
            return;
        }
    };
}

/// Absolute path to the shared eval corpus dir, resolved from the crate root so
/// it works regardless of the test's working directory.
fn corpus_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("eval")
        .join("ask")
        .join("corpus")
}

/// Read `corpus/manifest.json` → ordered map of doc basename → matter id.
fn read_manifest() -> BTreeMap<String, String> {
    let raw = std::fs::read_to_string(corpus_dir().join("manifest.json"))
        .expect("read corpus manifest.json");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("parse manifest.json");
    let docs = v
        .get("documents")
        .and_then(|d| d.as_object())
        .expect("manifest.documents object");
    docs.iter()
        .map(|(doc, entry)| {
            let matter = entry
                .get("matterId")
                .and_then(|m| m.as_str())
                .expect("matterId")
                .to_string();
            (doc.clone(), matter)
        })
        .collect()
}

/// Production read path: decrypt the `path_enc` column back to the plaintext
/// source id, exactly as `rag_retrieve` does after `store::nearest`.
async fn nearest(
    table: &lancedb::Table,
    query_vec: &[f32],
    top_k: usize,
    scope: Option<&str>,
) -> anyhow::Result<Vec<store::StoredHit>> {
    use keepance_lib::commands::mail::crypto::decrypt_with_key;
    let mut hits = store::nearest(table, query_vec, top_k, scope, false, &[]).await?;
    for h in &mut hits {
        let enc = h.path_enc.as_deref().expect("V10 rows carry path_enc");
        let blob = hex::decode(enc).expect("path_enc hex");
        let plain = String::from_utf8(decrypt_with_key(&blob, &VEC_KEY).expect("decrypt path_enc"))
            .expect("utf8 path");
        h.path = plain.clone();
        h.source_id = Some(plain);
    }
    Ok(hits)
}

async fn embed(query: &str) -> Vec<f32> {
    keepance_lib::commands::rag::embedder::embed_query(query)
        .await
        .expect("embed query")
}

/// Build the real `chunks` table over the shared corpus: each doc is read,
/// chunked by the production chunker, embedded with e5-small, and written under
/// its manifest matter id. The doc basename is used as the source path, so
/// retrieved `source_id`s come back as clean basenames for metric matching.
async fn build_table(dir: &std::path::Path) -> (lancedb::Table, tempfile::TempDir) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let conn = store::open_connection(tmp.path()).await.expect("open connection");
    let table = store::open_or_create_table(&conn).await.expect("create table");

    for (doc, matter) in read_manifest() {
        let text = std::fs::read_to_string(dir.join(&doc)).unwrap_or_else(|e| panic!("read {doc}: {e}"));
        let chunks = keepance_lib::commands::rag::chunker::chunk_text(&doc, &text);
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = keepance_lib::commands::rag::embedder::embed_documents(&texts)
            .await
            .expect("embed documents");
        let rows: Vec<(Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();
        let batch = store::build_batch(&rows, SourceType::Text, &matter, PRIVILEGE_NONE, None, &VEC_KEY)
            .expect("build batch");
        let schema = batch.schema();
        use arrow_array::RecordBatchIterator;
        table
            .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
            .execute()
            .await
            .expect("add batch");
    }
    (table, tmp)
}

/* ─────────────────────────── retrieval cases ──────────────────────────────
 * Mirrors tests/eval/ask/retrievalCases.ts (joined back by `id`). Each is a
 * (query, relevant source doc(s), scope) tuple.
 * ──────────────────────────────────────────────────────────────────────── */
struct RCase {
    id: &'static str,
    query: &'static str,
    expected: &'static [&'static str],
    /// None = allMatters (unscoped); Some(matter_id) = matter-scoped.
    scope: Option<&'static str>,
    top_k: usize,
}

fn cases() -> Vec<RCase> {
    vec![
        RCase { id: "r-johnson-severance", query: "How many weeks of severance was Marcus Johnson offered?", expected: &["johnson-deposition.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnston-severance", query: "How many weeks of severance was Marcus Johnston offered by Pinnacle Logistics?", expected: &["johnston-deposition.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnson-rate", query: "What hourly rate did Marcus Johnson agree to in his engagement letter?", expected: &["johnson-engagement-letter.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnston-rate", query: "What hourly attorney rate did Marcus Johnston agree to?", expected: &["johnston-engagement-letter.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnston-employer", query: "Which company is Marcus Johnston suing for wrongful termination?", expected: &["johnston-deposition.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnston-deadline", query: "What written-response deadline did the HR team give Marcus Johnston?", expected: &["johnston-deposition.md"], scope: None, top_k: 10 },
        RCase { id: "r-johnson-attorney", query: "Who is the responsible attorney for Marcus Johnson?", expected: &["johnson-engagement-letter.md"], scope: None, top_k: 10 },
        RCase { id: "r-telomere-rider", query: "What does the Telomere Assay Confidentiality Rider cover?", expected: &["nexus-diagnostics-nda.md"], scope: None, top_k: 10 },
        RCase { id: "r-ta204-damages", query: "What are the liquidated damages for disclosing the TA-204 assay methodology?", expected: &["nexus-diagnostics-nda.md"], scope: None, top_k: 10 },
        RCase { id: "r-nexus-diagnostics-parties", query: "Who are the parties to the Nexus Diagnostics non-disclosure agreement?", expected: &["nexus-diagnostics-nda.md"], scope: None, top_k: 10 },
        RCase { id: "r-acme-term", query: "What is the term length of the Acme Road Runner supply agreement?", expected: &["acme-supply-agreement.md"], scope: None, top_k: 10 },
        RCase { id: "r-acme-product", query: "What product does the Acme supply agreement cover?", expected: &["acme-supply-agreement.md"], scope: None, top_k: 10 },
        RCase { id: "r-acme-insurance", query: "What cargo insurance must Road Runner carry under the agreement?", expected: &["acme-supply-agreement.md"], scope: None, top_k: 10 },
        RCase { id: "r-scoped-johnson-severance", query: "severance package offered and declined", expected: &["johnson-deposition.md"], scope: Some("matter-johnson"), top_k: 10 },
        RCase { id: "r-scoped-johnston-rate", query: "attorney hourly billing rate in the engagement letter", expected: &["johnston-engagement-letter.md"], scope: Some("matter-johnston"), top_k: 10 },
    ]
}

/* ───────────────────────────── metrics ────────────────────────────────── */

/// Collapse a ranked hit list to distinct source basenames (best rank first).
fn ranked_sources(hits: &[store::StoredHit]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for h in hits {
        if let Some(sid) = h.source_id.as_deref() {
            let base = sid.rsplit(['/', '\\']).next().unwrap_or(sid).to_string();
            if seen.insert(base.clone()) {
                out.push(base);
            }
        }
    }
    out
}

fn first_relevant_rank(ranked: &[String], relevant: &[&str]) -> Option<usize> {
    ranked.iter().position(|s| relevant.contains(&s.as_str())).map(|i| i + 1)
}

fn reciprocal_rank(ranked: &[String], relevant: &[&str]) -> f64 {
    first_relevant_rank(ranked, relevant).map_or(0.0, |r| 1.0 / r as f64)
}

fn precision_at_k(ranked: &[String], relevant: &[&str], k: usize) -> f64 {
    if k == 0 { return 0.0; }
    let hits = ranked.iter().take(k).filter(|s| relevant.contains(&s.as_str())).count();
    hits as f64 / k as f64
}

fn hit_at_k(ranked: &[String], relevant: &[&str], k: usize) -> bool {
    first_relevant_rank(ranked, relevant).is_some_and(|r| r <= k)
}

fn dcg_at_k(ranked: &[String], relevant: &[&str], k: usize) -> f64 {
    ranked.iter().take(k).enumerate().fold(0.0, |acc, (i, s)| {
        if relevant.contains(&s.as_str()) { acc + 1.0 / ((i + 2) as f64).log2() } else { acc }
    })
}

fn ndcg_at_k(ranked: &[String], relevant: &[&str], k: usize) -> f64 {
    let idcg: f64 = (0..relevant.len().min(k)).map(|i| 1.0 / ((i + 2) as f64).log2()).sum();
    if idcg == 0.0 { 0.0 } else { dcg_at_k(ranked, relevant, k) / idcg }
}

fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() { 0.0 } else { xs.iter().sum::<f64>() / xs.len() as f64 }
}

#[tokio::test]
async fn retrieval_quality_baseline() {
    skip_without_model!();
    let dir = corpus_dir();
    let (table, _tmp) = build_table(&dir).await;

    let mut rr = Vec::new();
    let mut ndcg5 = Vec::new();
    let (mut p1, mut p3, mut p5) = (Vec::new(), Vec::new(), Vec::new());
    let (mut h1, mut h3, mut h5) = (Vec::new(), Vec::new(), Vec::new());
    let mut case_json = Vec::new();

    println!("\n══════════ WS3b RETRIEVAL-QUALITY BASELINE (real e5-small + LanceDB) ══════════");
    println!("{:<32} {:>4} {:>6}  ranked sources (best rank per doc)", "case", "rank", "RR");

    for c in cases() {
        let q = embed(c.query).await;
        let hits = nearest(&table, &q, c.top_k, c.scope).await.expect("retrieve");
        let ranked = ranked_sources(&hits);
        let rank = first_relevant_rank(&ranked, c.expected);
        let case_rr = reciprocal_rank(&ranked, c.expected);

        rr.push(case_rr);
        ndcg5.push(ndcg_at_k(&ranked, c.expected, 5));
        p1.push(precision_at_k(&ranked, c.expected, 1));
        p3.push(precision_at_k(&ranked, c.expected, 3));
        p5.push(precision_at_k(&ranked, c.expected, 5));
        h1.push(if hit_at_k(&ranked, c.expected, 1) { 1.0 } else { 0.0 });
        h3.push(if hit_at_k(&ranked, c.expected, 3) { 1.0 } else { 0.0 });
        h5.push(if hit_at_k(&ranked, c.expected, 5) { 1.0 } else { 0.0 });

        let rank_s = rank.map_or("—".to_string(), |r| r.to_string());
        println!("{:<32} {:>4} {:>6.3}  {}", c.id, rank_s, case_rr, ranked.join(" > "));

        let scope_s = c.scope.map_or("allMatters".to_string(), |m| format!("matter:{m}"));
        case_json.push(serde_json::json!({
            "id": c.id,
            "scope": scope_s,
            "topK": c.top_k,
            "expectedSources": c.expected,
            "rankedSources": ranked,
            "rankOfFirstRelevant": rank,
            "reciprocalRank": case_rr,
        }));
    }

    let summary = serde_json::json!({
        "n": rr.len(),
        "mrr": mean(&rr),
        "ndcgAt5": mean(&ndcg5),
        "pAt1": mean(&p1),
        "pAt3": mean(&p3),
        "pAt5": mean(&p5),
        "hitAt1": mean(&h1),
        "hitAt3": mean(&h3),
        "hitAt5": mean(&h5),
    });

    println!("\n── SUMMARY (n={}) ─────────────────────────────────", rr.len());
    println!("   MRR        {:.4}", mean(&rr));
    println!("   NDCG@5     {:.4}", mean(&ndcg5));
    println!("   P@1 {:.4}  P@3 {:.4}  P@5 {:.4}", mean(&p1), mean(&p3), mean(&p5));
    println!("   Hit@1 {:.3}  Hit@3 {:.3}  Hit@5 {:.3}", mean(&h1), mean(&h3), mean(&h5));
    println!("───────────────────────────────────────────────────\n");

    // Write the machine-readable artifact (gitignored) for the TS cross-check.
    let report = serde_json::json!({
        "model": "multilingual-e5-small",
        "engine": "fastembed + lancedb (real shipped stack)",
        "summary": summary,
        "cases": case_json,
    });
    let results_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("tests").join("eval").join("ask").join("results");
    let _ = std::fs::create_dir_all(&results_dir);
    std::fs::write(
        results_dir.join("retrieval-latest.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .expect("write retrieval-latest.json");

    // Regression FLOOR. e5-small over this small adversarial corpus is expected
    // to rank the right document at or near the top for almost every query.
    // The floor is deliberately a margin below the measured baseline so ordinary
    // numerical jitter never reds the run, while a real retrieval regression does.
    let mrr = mean(&rr);
    let hit3 = mean(&h3);
    assert!(
        mrr >= 0.70,
        "retrieval MRR {mrr:.4} fell below the 0.70 floor — a real retrieval regression. \
         See tests/eval/ask/results/retrieval-latest.json"
    );
    assert!(
        hit3 >= 0.80,
        "retrieval Hit@3 {hit3:.4} fell below the 0.80 floor — the right document is missing \
         from the top 3 too often. See tests/eval/ask/results/retrieval-latest.json"
    );
}
