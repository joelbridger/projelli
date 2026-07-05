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
//!   REQUIRE_RAG_MODEL=1 cargo test -p lantern --test rag_retrieval_quality -- --nocapture

use lantern_lib::commands::rag::chunker::Chunk;
use lantern_lib::commands::rag::store::{self, SourceType, PRIVILEGE_NONE};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Fixed vector-store key so the test never touches the OS keychain. WS-VEC:
/// every chunk's `text`/`path` column is ciphertext under this key.
const VEC_KEY: [u8; 32] = [0x5Au8; 32];

/// Returns true when the e5-small model cache is provisioned (same resolution as
/// the production embedder).
fn model_is_provisioned() -> bool {
    use lantern_lib::commands::rag::embedder::resolve_cache_dir;
    use lantern_lib::commands::rag::model_download::model_files_cached;
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
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
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
    lantern_lib::commands::rag::embedder::embed_query(query)
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
        let chunks = lantern_lib::commands::rag::chunker::chunk_text(&doc, &text);
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = lantern_lib::commands::rag::embedder::embed_documents(&texts)
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

/* ════════════════════ WS3d-A — RERANKER OFF vs ON ════════════════════════
 * Measures the cross-encoder reranker against the SAME real shipped stack and
 * the SAME adversarial corpus as the baseline above. For every case we fetch a
 * deliberately OVERFETCHED candidate pool (top_k*4, exactly what the production
 * `rag_retrieve` does when the reranker is on), then score it two ways:
 *
 *   OFF — take the first top_k candidates in vector (cosine) order. This is
 *         byte-for-byte the committed baseline path (the first N of the
 *         nearest-N-overfetch ARE the nearest-N), so the OFF numbers MUST equal
 *         the frozen `retrieval-baseline.json` — the proof that the flag's
 *         OFF state is a true no-op.
 *   ON  — re-score the whole pool with the production `reranker::rescore`
 *         cross-encoder, re-sort by that score, take top_k. This is the
 *         production reranker-ON path.
 *
 * Both are graded with the IDENTICAL metric functions, and the deltas are
 * printed + written to results/retrieval-reranked-latest.json. This is the
 * headline evidence. The reranker is NOT enabled by this test — it only
 * measures. Gated by REQUIRE_RAG_MODEL (e5) AND the reranker model being
 * provisioned (REQUIRE_RERANKER_MODEL=1 turns a missing reranker into a hard
 * failure instead of a silent skip).
 * ────────────────────────────────────────────────────────────────────────── */

/// Decrypt a hit's chunk text exactly as `rag_retrieve` does before handing it
/// to the reranker (WS-VEC: the `text` column is ciphertext at rest).
fn decrypt_text(h: &store::StoredHit) -> String {
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
    if h.encrypted {
        hex::decode(&h.text)
            .ok()
            .and_then(|b| decrypt_with_key(&b, &VEC_KEY).ok())
            .and_then(|v| String::from_utf8(v).ok())
            .unwrap_or_default()
    } else {
        h.text.clone()
    }
}

/// Aggregate metrics over all cases, given a per-case ranked source list.
struct Agg {
    rr: Vec<f64>,
    ndcg5: Vec<f64>,
    h1: Vec<f64>,
    h3: Vec<f64>,
    h5: Vec<f64>,
    p1: Vec<f64>,
}
impl Agg {
    fn new() -> Self {
        Self { rr: vec![], ndcg5: vec![], h1: vec![], h3: vec![], h5: vec![], p1: vec![] }
    }
    fn push(&mut self, ranked: &[String], expected: &[&str]) {
        self.rr.push(reciprocal_rank(ranked, expected));
        self.ndcg5.push(ndcg_at_k(ranked, expected, 5));
        self.h1.push(if hit_at_k(ranked, expected, 1) { 1.0 } else { 0.0 });
        self.h3.push(if hit_at_k(ranked, expected, 3) { 1.0 } else { 0.0 });
        self.h5.push(if hit_at_k(ranked, expected, 5) { 1.0 } else { 0.0 });
        self.p1.push(precision_at_k(ranked, expected, 1));
    }
    fn mrr(&self) -> f64 { mean(&self.rr) }
    fn ndcg(&self) -> f64 { mean(&self.ndcg5) }
    fn hit1(&self) -> f64 { mean(&self.h1) }
    fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "n": self.rr.len(),
            "mrr": mean(&self.rr),
            "ndcgAt5": mean(&self.ndcg5),
            "hitAt1": mean(&self.h1),
            "hitAt3": mean(&self.h3),
            "hitAt5": mean(&self.h5),
            "pAt1": mean(&self.p1),
        })
    }
}

#[tokio::test]
async fn retrieval_reranker_off_vs_on() {
    skip_without_model!();
    // Reranker presence gate (mirrors the e5 gate). REQUIRE_RERANKER_MODEL=1
    // makes a missing reranker a hard failure rather than a silent skip.
    use lantern_lib::commands::rag::reranker;
    if !reranker::is_available() {
        if std::env::var("REQUIRE_RERANKER_MODEL").ok().filter(|v| !v.is_empty()).is_some() {
            panic!(
                "REQUIRE_RERANKER_MODEL set but the reranker model is not provisioned — \
                 run: cargo test -p lantern --lib provision_reranker_into_writable_cache -- --ignored"
            );
        }
        eprintln!("SKIP retrieval_reranker_off_vs_on: reranker model not provisioned");
        return;
    }

    let dir = corpus_dir();
    let (table, _tmp) = build_table(&dir).await;

    let mut off = Agg::new();
    let mut on = Agg::new();
    let mut case_json = Vec::new();

    println!("\n══════════ WS3d-A RERANKER OFF vs ON (real e5-small + LanceDB + cross-encoder) ══════════");
    println!("model: {}", reranker::RERANKER_MODEL);
    println!("{:<32} {:>8} {:>8}   off→on ranked sources", "case", "off RR", "on RR");

    for c in cases() {
        let q = embed(c.query).await;
        // OVERFETCH exactly like production rag_retrieve does when reranking.
        let overfetch = c.top_k.saturating_mul(4).min(200);
        let pool = nearest(&table, &q, overfetch, c.scope).await.expect("retrieve");

        // OFF: first top_k in cosine order == the committed baseline path.
        let off_hits: Vec<store::StoredHit> = pool.iter().take(c.top_k).cloned().collect();
        let off_ranked = ranked_sources(&off_hits);
        off.push(&off_ranked, c.expected);

        // ON: cross-encoder rescore over the whole pool, re-sort, take top_k.
        let texts: Vec<String> = pool.iter().map(decrypt_text).collect();
        let scores = reranker::rescore(c.query, texts).await.expect("rescore");
        assert_eq!(scores.len(), pool.len(), "one score per candidate");
        let mut scored: Vec<(f32, store::StoredHit)> =
            scores.into_iter().zip(pool.iter().cloned()).collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        let on_hits: Vec<store::StoredHit> =
            scored.into_iter().take(c.top_k).map(|(_, h)| h).collect();
        let on_ranked = ranked_sources(&on_hits);
        on.push(&on_ranked, c.expected);

        let off_rr = reciprocal_rank(&off_ranked, c.expected);
        let on_rr = reciprocal_rank(&on_ranked, c.expected);
        let arrow = if on_rr > off_rr { "▲" } else if on_rr < off_rr { "▼" } else { "=" };
        println!(
            "{:<32} {:>8.3} {:>8.3} {}  {}",
            c.id, off_rr, on_rr, arrow, on_ranked.join(" > ")
        );

        case_json.push(serde_json::json!({
            "id": c.id,
            "offRankedSources": off_ranked,
            "onRankedSources": on_ranked,
            "offReciprocalRank": off_rr,
            "onReciprocalRank": on_rr,
        }));
    }

    println!("\n── SUMMARY (n={}) ─────────────────────────────────", off.rr.len());
    println!("            {:>10} {:>10} {:>10}", "OFF", "ON", "Δ (on-off)");
    println!("   MRR      {:>10.4} {:>10.4} {:>+10.4}", off.mrr(), on.mrr(), on.mrr() - off.mrr());
    println!("   NDCG@5   {:>10.4} {:>10.4} {:>+10.4}", off.ndcg(), on.ndcg(), on.ndcg() - off.ndcg());
    println!("   Hit@1    {:>10.4} {:>10.4} {:>+10.4}", off.hit1(), on.hit1(), on.hit1() - off.hit1());
    println!("───────────────────────────────────────────────────\n");

    // Persist the comparison artifact (gitignored, alongside the baseline one).
    let report = serde_json::json!({
        "model": format!("{}", reranker::RERANKER_MODEL),
        "engine": "fastembed reranker + e5-small + lancedb (real shipped stack)",
        "off": off.json(),
        "on": on.json(),
        "cases": case_json,
    });
    let results_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("tests").join("eval").join("ask").join("results");
    let _ = std::fs::create_dir_all(&results_dir);
    std::fs::write(
        results_dir.join("retrieval-reranked-latest.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .expect("write retrieval-reranked-latest.json");

    // PROOF THE FLAG'S OFF STATE IS A NO-OP: the OFF numbers must match the
    // committed baseline snapshot. (Reads retrieval-baseline.json so a baseline
    // refresh keeps this honest.)
    let baseline: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..").join("tests").join("eval").join("ask").join("retrieval-baseline.json"),
        )
        .expect("read retrieval-baseline.json"),
    )
    .expect("parse baseline");
    let base_mrr = baseline["summary"]["mrr"].as_f64().expect("baseline summary.mrr");
    assert!(
        (off.mrr() - base_mrr).abs() < 1e-9,
        "reranker-OFF MRR {:.6} must equal the committed baseline {:.6} — the OFF path is NOT a no-op!",
        off.mrr(),
        base_mrr
    );
}

/* ════════════════════ WS3d-B — HYBRID (BM25) OFF vs ON ════════════════════
 * Measures hybrid (BM25 keyword + vector) retrieval against the SAME real
 * shipped stack and adversarial corpus as the baseline above, using the SAME
 * production code paths (`store::read_all_for_keyword_index`, `Bm25Index`,
 * `store::fetch_by_ids_scoped`, `bm25_index::rrf_fuse`).
 *
 *   OFF — first top_k candidates in vector (cosine) order == byte-for-byte the
 *         committed baseline path, so the OFF numbers MUST equal the frozen
 *         `retrieval-baseline.json` — proof the flag's OFF state is a true no-op.
 *   ON  — BM25 keyword search WITHIN the case scope, keyword-only candidates
 *         re-fetched through the IDENTICAL scoped predicate, then fused with the
 *         vector ranking via RRF and truncated to top_k — exactly what the
 *         production `rag_retrieve` hybrid seam does.
 *
 * Only e5 is required (BM25 needs no model). The flag is NOT enabled by this
 * test — it only measures.
 * ────────────────────────────────────────────────────────────────────────── */

/// Decrypt `path_enc` → plaintext source id for a freshly fetched StoredHit (the
/// `nearest` helper does this for the vector pool; keyword-only candidates from
/// `fetch_by_ids_scoped` need the same so `ranked_sources` sees clean basenames).
fn decrypt_source_id(h: &mut store::StoredHit) {
    use lantern_lib::commands::mail::crypto::decrypt_with_key;
    if let Some(enc) = h.path_enc.as_deref() {
        if let Some(plain) = hex::decode(enc)
            .ok()
            .and_then(|b| decrypt_with_key(&b, &VEC_KEY).ok())
            .and_then(|v| String::from_utf8(v).ok())
        {
            h.path = plain.clone();
            h.source_id = Some(plain);
        }
    }
}

#[tokio::test]
async fn retrieval_hybrid_off_vs_on() {
    skip_without_model!();
    use lantern_lib::commands::rag::bm25_index::{rrf_fuse, Bm25Index, RRF_K};

    let dir = corpus_dir();
    let (table, _tmp) = build_table(&dir).await;

    // Build the keyword index from the real table, exactly as production does.
    let entries = store::read_all_for_keyword_index(&table, &VEC_KEY, &[])
        .await
        .expect("read keyword index");
    let version = table.version().await.unwrap_or(0);
    let mut bm25 = Bm25Index::new();
    bm25.rebuild_from(entries, version);

    let mut off = Agg::new();
    let mut on = Agg::new();
    let mut case_json = Vec::new();

    println!("\n══════════ WS3d-B HYBRID OFF vs ON (real e5-small + LanceDB + BM25) ══════════");
    println!("{:<32} {:>8} {:>8}   off→on ranked sources", "case", "off RR", "on RR");

    for c in cases() {
        let q = embed(c.query).await;
        // OVERFETCH exactly like production rag_retrieve does when hybrid is on.
        let overfetch = c.top_k.saturating_mul(4).min(200);
        let pool = nearest(&table, &q, overfetch, c.scope).await.expect("retrieve");

        // OFF: first top_k in cosine order == the committed baseline path.
        let off_hits: Vec<store::StoredHit> = pool.iter().take(c.top_k).cloned().collect();
        let off_ranked = ranked_sources(&off_hits);
        off.push(&off_ranked, c.expected);

        // ON: BM25 keyword search within scope; fuse with the vector ranking.
        let keyword_ranked: Vec<String> = bm25
            .search(c.query, overfetch, c.scope, false, &[])
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        let vector_ranked: Vec<String> = pool
            .iter()
            .filter(|h| !h.id.is_empty())
            .map(|h| h.id.clone())
            .collect();

        // Candidate hit map by chunk id: the vector pool, plus keyword-only
        // candidates re-fetched through the SAME scoped predicate.
        let mut by_id: std::collections::HashMap<String, store::StoredHit> =
            std::collections::HashMap::new();
        for h in &pool {
            if !h.id.is_empty() {
                by_id.entry(h.id.clone()).or_insert_with(|| h.clone());
            }
        }
        let have: std::collections::HashSet<&str> =
            pool.iter().map(|h| h.id.as_str()).collect();
        let keyword_only: Vec<String> = keyword_ranked
            .iter()
            .filter(|id| !have.contains(id.as_str()))
            .cloned()
            .collect();
        if !keyword_only.is_empty() {
            let extra = store::fetch_by_ids_scoped(&table, &keyword_only, c.scope, false, &[])
                .await
                .expect("fetch keyword-only candidates");
            for mut h in extra {
                decrypt_source_id(&mut h);
                if !h.id.is_empty() {
                    by_id.entry(h.id.clone()).or_insert(h);
                }
            }
        }

        let fused = rrf_fuse(&vector_ranked, &keyword_ranked, RRF_K);
        let on_hits: Vec<store::StoredHit> = fused
            .iter()
            .filter_map(|(id, _)| by_id.get(id).cloned())
            .take(c.top_k)
            .collect();
        let on_ranked = ranked_sources(&on_hits);
        on.push(&on_ranked, c.expected);

        let off_rr = reciprocal_rank(&off_ranked, c.expected);
        let on_rr = reciprocal_rank(&on_ranked, c.expected);
        let arrow = if on_rr > off_rr { "▲" } else if on_rr < off_rr { "▼" } else { "=" };
        println!(
            "{:<32} {:>8.3} {:>8.3} {}  {}",
            c.id, off_rr, on_rr, arrow, on_ranked.join(" > ")
        );

        case_json.push(serde_json::json!({
            "id": c.id,
            "offRankedSources": off_ranked,
            "onRankedSources": on_ranked,
            "offReciprocalRank": off_rr,
            "onReciprocalRank": on_rr,
        }));
    }

    println!("\n── SUMMARY (n={}) ─────────────────────────────────", off.rr.len());
    println!("            {:>10} {:>10} {:>10}", "OFF", "ON", "Δ (on-off)");
    println!("   MRR      {:>10.4} {:>10.4} {:>+10.4}", off.mrr(), on.mrr(), on.mrr() - off.mrr());
    println!("   NDCG@5   {:>10.4} {:>10.4} {:>+10.4}", off.ndcg(), on.ndcg(), on.ndcg() - off.ndcg());
    println!("   Hit@1    {:>10.4} {:>10.4} {:>+10.4}", off.hit1(), on.hit1(), on.hit1() - off.hit1());
    println!("───────────────────────────────────────────────────\n");

    let report = serde_json::json!({
        "engine": "bm25 keyword + e5-small + lancedb (real shipped stack), RRF fusion",
        "off": off.json(),
        "on": on.json(),
        "cases": case_json,
    });
    let results_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..").join("tests").join("eval").join("ask").join("results");
    let _ = std::fs::create_dir_all(&results_dir);
    std::fs::write(
        results_dir.join("retrieval-hybrid-latest.json"),
        serde_json::to_string_pretty(&report).unwrap(),
    )
    .expect("write retrieval-hybrid-latest.json");

    // PROOF THE FLAG'S OFF STATE IS A NO-OP: OFF == committed baseline.
    let baseline: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..").join("tests").join("eval").join("ask").join("retrieval-baseline.json"),
        )
        .expect("read retrieval-baseline.json"),
    )
    .expect("parse baseline");
    let base_mrr = baseline["summary"]["mrr"].as_f64().expect("baseline summary.mrr");
    assert!(
        (off.mrr() - base_mrr).abs() < 1e-9,
        "hybrid-OFF MRR {:.6} must equal the committed baseline {:.6} — the OFF path is NOT a no-op!",
        off.mrr(),
        base_mrr
    );

    // Hybrid ON must not MATERIALLY regress retrieval quality (small numeric
    // jitter from fusion ties is tolerated). The headline numbers above are the
    // real evidence; this guard only catches a true regression.
    assert!(
        on.mrr() >= off.mrr() - 0.05,
        "hybrid-ON MRR {:.4} regressed materially below OFF {:.4}",
        on.mrr(),
        off.mrr()
    );
}
