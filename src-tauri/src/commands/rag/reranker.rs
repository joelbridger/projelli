// Lazy-initialized cross-encoder RERANKER backed by fastembed-rs.
//
// WS3d-A. A reranker is a *second*, more expensive scorer that reads the
// query and a candidate chunk TOGETHER (a "cross-encoder") and returns a
// relevance score. The first-pass vector search (e5-small) scores the query
// and each chunk SEPARATELY, which is fast but coarse; the reranker re-orders
// the small set the vector search already found, so a strongly-relevant chunk
// the vector pass ranked 8th can be promoted to the top.
//
// This module is the inference side only. It mirrors `embedder.rs`:
//   * one process-wide instance behind an `OnceCell`,
//   * load from the LOCAL cache only — never an implicit network download
//     (the only network path is `reranker_download::reranker_ensure`), so a
//     retrieval call can never silently stall on a multi-MB fetch,
//   * fastembed's `rerank` is `&self` + thread-safe, so a plain
//     `Arc<TextRerank>` is enough; no Mutex.
//
// GRACEFUL FALLBACK is the contract: every helper here returns a `Result`.
// When the model isn't downloaded, fails to load, or rescoring errors, the
// caller (the retrieval seam in `mod.rs`) is expected to keep the existing
// vector-only ordering — re-ranking is a best-effort improvement layer, never
// a hard dependency on the answer path.

use anyhow::{Context, Result};
use fastembed::{RerankInitOptions, RerankerModel, TextRerank};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// The reranker model. `JINARerankerV1TurboEn` is a small (~37M-param),
/// English-tuned cross-encoder — the right fit for an English legal corpus
/// and small enough (~150 MB ONNX) to download and run on a laptop CPU. The
/// model choice is centralized here so `reranker_download` stays in sync via
/// the `required_files_match_fastembed` test.
pub const RERANKER_MODEL: RerankerModel = RerankerModel::JINARerankerV1TurboEn;

/// Typed marker for "the reranker model files aren't downloaded yet".
/// Embedded in error strings; lets the caller distinguish "not provisioned"
/// (fall back quietly) from a genuine inference failure.
pub const RERANKER_NOT_READY: &str = "reranker-not-ready";

/// Singleton handle. `get_or_try_init` runs the constructor at most once even
/// under concurrent first use.
static RERANKER: OnceCell<Arc<TextRerank>> = OnceCell::const_new();

/// Resolve the cache dir the reranker loads from. Mirrors the embedder's
/// resolution: a populated bundled copy adjacent to the executable wins;
/// otherwise the single user-writable dir `reranker_download` writes into.
pub fn resolve_cache_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidates = [
                exe_dir.join("resources").join("reranker"),
                exe_dir.join("..").join("Resources").join("reranker"),
            ];
            for cand in candidates {
                if super::reranker_download::model_files_cached(&cand) {
                    return cand;
                }
            }
        }
    }
    super::reranker_download::writable_cache_dir()
}

/// True when the reranker model files are present locally (bundled or
/// downloaded). Pure filesystem check — cheap enough for a per-call gate.
pub fn is_available() -> bool {
    super::reranker_download::model_files_cached(&resolve_cache_dir())
}

/// Get the singleton reranker, initializing on first use. Fails fast with the
/// `RERANKER_NOT_READY` marker when the model isn't cached — it NEVER triggers
/// an implicit download (parity with the embedder's `MODEL_NOT_READY` gate).
async fn get_reranker() -> Result<Arc<TextRerank>> {
    RERANKER
        .get_or_try_init(|| async {
            let cache_dir = resolve_cache_dir();
            let check_dir = cache_dir.clone();
            let cached = tokio::task::spawn_blocking(move || {
                super::reranker_download::model_files_cached(&check_dir)
            })
            .await
            .context("reranker presence check join failed")?;
            if !cached {
                anyhow::bail!("{RERANKER_NOT_READY}: the reranker model is not downloaded yet");
            }
            // ONNX session construction is CPU-bound and blocks for a few
            // hundred ms; hop to a blocking task so the Tauri runtime stays
            // responsive.
            let model = tokio::task::spawn_blocking(move || -> Result<TextRerank> {
                let opts = RerankInitOptions::new(RERANKER_MODEL)
                    .with_cache_dir(cache_dir)
                    .with_show_download_progress(false);
                TextRerank::try_new(opts).context("failed to initialize fastembed reranker model")
            })
            .await
            .context("reranker init join failed")??;
            Ok::<_, anyhow::Error>(Arc::new(model))
        })
        .await
        .cloned()
}

/// Initialize (or reuse) the reranker without scoring anything. Used by
/// `reranker_ensure` as the post-download verification step.
pub async fn warm_init() -> Result<()> {
    get_reranker().await.map(|_| ())
}

/// True only when the reranker is present AND successfully loaded (the model
/// instance is constructed and cached, so a subsequent `rescore` reuses it).
///
/// The retrieval seam calls this BEFORE deciding whether to overfetch a larger
/// candidate pool. That makes the fallback EXACT: if the model is absent or
/// fails to load, this returns false, the caller never overfetches, and
/// retrieval is byte-for-byte the vector-only path (not merely "close"). It
/// folds the absent-check and the load-check into one decision so the only
/// residual failure left for `rescore` is a post-load inference error — by
/// then the model has demonstrably loaded, so that path is vanishingly rare.
pub async fn ensure_ready() -> bool {
    get_reranker().await.is_ok()
}

/// Map a raw cross-encoder logit to a `[0, 1]` score with the logistic
/// sigmoid. Monotonic, so it changes NONE of the resulting order — it only
/// makes the score renderable as a confidence percentage alongside the
/// vector-pass scores, which already live in `[0, 1]`.
#[inline]
pub fn logit_to_score(logit: f32) -> f32 {
    1.0 / (1.0 + (-logit).exp())
}

/// Re-score `texts` against `query` with the cross-encoder. Returns one score
/// per input, IN INPUT ORDER (sigmoid-mapped to `[0, 1]`, higher = better).
///
/// `Err` on any failure (model absent, load failure, inference error). The
/// caller MUST treat an error as "keep the existing vector-only order" — this
/// is the graceful-fallback contract; it never panics and never blocks an
/// answer.
pub async fn rescore(query: &str, texts: Vec<String>) -> Result<Vec<f32>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let model = get_reranker().await?;
    let query = query.to_string();
    let n = texts.len();
    let results = tokio::task::spawn_blocking(move || {
        // return_documents=false: we only need (index, score); the documents
        // already live in the caller's hit list.
        model
            .rerank(&query, texts.iter().collect::<Vec<_>>(), false, None)
            .context("cross-encoder rerank failed")
    })
    .await
    .context("rescore join failed")??;

    // `rerank` returns results sorted by score desc, each carrying its
    // ORIGINAL index. Scatter them back into input order so the caller can
    // assign scores positionally to its already-built hit list.
    let mut scores = vec![0.0f32; n];
    for r in results {
        if r.index < n {
            scores[r.index] = logit_to_score(r.score);
        }
    }
    Ok(scores)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sigmoid_is_centered_and_monotonic() {
        assert!((logit_to_score(0.0) - 0.5).abs() < 1e-6);
        assert!(logit_to_score(10.0) > 0.99);
        assert!(logit_to_score(-10.0) < 0.01);
        // Monotonic: a higher logit always yields a higher score.
        assert!(logit_to_score(2.0) > logit_to_score(1.0));
        assert!(logit_to_score(-1.0) < logit_to_score(0.0));
    }

    #[test]
    fn sigmoid_stays_in_unit_interval_for_extremes() {
        for logit in [-1e6, -100.0, 0.0, 100.0, 1e6f32] {
            let s = logit_to_score(logit);
            assert!((0.0..=1.0).contains(&s), "logit {logit} -> {s} out of range");
        }
    }

    #[test]
    fn cache_dir_is_absolute() {
        assert!(resolve_cache_dir().is_absolute());
    }

    #[tokio::test]
    async fn rescore_of_empty_is_empty() {
        let out = rescore("anything", Vec::new()).await.expect("empty ok");
        assert!(out.is_empty());
    }

    /// When the model is not provisioned, rescore returns an Err carrying the
    /// NOT_READY marker (the caller's signal to fall back to vector-only) —
    /// it must NOT panic and must NOT attempt a download.
    #[tokio::test]
    async fn rescore_without_model_errors_not_ready() {
        if is_available() {
            // A real model is cached on this machine; the not-ready path can't
            // be exercised here. The provisioned path is covered by the eval.
            return;
        }
        let err = rescore("q", vec!["doc".to_string()])
            .await
            .expect_err("must error when model absent");
        assert!(
            format!("{err:#}").contains(RERANKER_NOT_READY),
            "expected NOT_READY marker, got: {err:#}"
        );
    }
}
